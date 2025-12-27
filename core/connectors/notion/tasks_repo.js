const { createNotionHttpClient } = require('./client');

class NotionTasksRepo {
  constructor({ notionToken, databaseId }) {
    this._dbId = databaseId;
    this._http = createNotionHttpClient({ notionToken });
    this._schema = null; // cached db.properties
  }

  async getDatabase() {
    const resp = await this._http.get(`databases/${this._dbId}`);
    return resp.data;
  }

  async _ensureSchema() {
    if (this._schema) return this._schema;
    const db = await this.getDatabase();
    this._schema = db.properties || {};
    return this._schema;
  }

  _hasProp(schema, name) {
    return Boolean(schema && Object.prototype.hasOwnProperty.call(schema, name));
  }

  async getOptions() {
    const db = await this.getDatabase();
    const tags = db.properties?.Tags?.multi_select?.options?.map((o) => o.name) || [];
    const priority = db.properties?.Priority?.select?.options?.map((o) => o.name) || [];
    const status = db.properties?.Status?.status?.options?.map((o) => o.name) || [];
    return { tags, priority, status };
  }

  async listTasks({ tag, status, dueDate, dueDateOnOrAfter, dueDateBefore, queryText, limit = 100 } = {}) {
    const payload = {
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: Math.min(Math.max(1, Number(limit) || 100), 100),
    };

    const filters = [];
    if (tag) {
      filters.push({ property: 'Tags', multi_select: { contains: tag } });
    }
    if (status) {
      // Status property type is "status"
      filters.push({ property: 'Status', status: { equals: status } });
    }
    if (dueDateOnOrAfter || dueDateBefore) {
      const date = {};
      if (dueDateOnOrAfter) date.on_or_after = dueDateOnOrAfter;
      if (dueDateBefore) date.before = dueDateBefore;
      filters.push({ property: 'Due Date', date });
    } else if (dueDate) {
      filters.push({ property: 'Due Date', date: { equals: dueDate } });
    }
    if (queryText) {
      // Search inside title (Name) if the property exists.
      filters.push({ property: 'Name', title: { contains: queryText } });
    }
    if (filters.length === 1) payload.filter = filters[0];
    if (filters.length > 1) payload.filter = { and: filters };

    const resp = await this._http.post(`databases/${this._dbId}/query`, payload);
    return (resp.data.results || []).map((p) => this._pageToTask(p));
  }

  async createTask({ title, tag, priority, dueDate, status }) {
    const schema = await this._ensureSchema();
    const props = {};

    // Name
    if (this._hasProp(schema, 'Name')) {
      props.Name = { title: [{ text: { content: title } }] };
    }

    // Tags
    if (this._hasProp(schema, 'Tags')) {
      props.Tags = { multi_select: tag ? [{ name: tag }] : [] };
    }

    // Priority
    if (this._hasProp(schema, 'Priority')) {
      props.Priority = { select: priority ? { name: priority } : null };
    }

    // Due Date
    if (this._hasProp(schema, 'Due Date')) {
      props['Due Date'] = { date: dueDate ? { start: dueDate } : null };
    }

    // Status
    if (this._hasProp(schema, 'Status')) {
      props.Status = { status: { name: status || 'Idle' } };
    }

    const resp = await this._http.post('pages', {
      parent: { database_id: this._dbId },
      properties: props,
    });
    return this._pageToTask(resp.data);
  }

  async updateTask({ pageId, title, tag, priority, dueDate, status }) {
    const schema = await this._ensureSchema();
    const props = {};

    // NOTE:
    // - undefined means "do not change"
    // - null means "clear" (where Notion supports it, e.g. select/date/multi_select)
    if (title !== undefined && this._hasProp(schema, 'Name')) {
      const safeTitle = String(title || '').trim();
      if (safeTitle) {
        props.Name = { title: [{ text: { content: safeTitle } }] };
      }
    }

    // Tags
    // - undefined => do not change tags
    // - null => clear tags
    // - string => set exactly one tag
    if (tag !== undefined && this._hasProp(schema, 'Tags')) {
      props.Tags = { multi_select: tag ? [{ name: tag }] : [] };
    }

    // Priority
    if (priority !== undefined && this._hasProp(schema, 'Priority')) {
      props.Priority = { select: priority ? { name: priority } : null };
    }

    // Due Date
    if (dueDate !== undefined && this._hasProp(schema, 'Due Date')) {
      props['Due Date'] = { date: dueDate ? { start: dueDate } : null };
    }

    // Status
    if (status !== undefined && this._hasProp(schema, 'Status')) {
      // If status is null/empty, keep it unchanged (do not reset to Idle).
      const safeStatus = typeof status === 'string' ? status.trim() : '';
      if (safeStatus) {
        props.Status = { status: { name: safeStatus } };
      }
    }

    // If nothing to patch, return current page snapshot via minimal fetch is not implemented here.
    // Caller should avoid calling updateTask with all fields undefined.
    if (!Object.keys(props).length) {
      return { id: pageId, title: null, status: null, priority: null, dueDate: null, tags: [] };
    }

    const resp = await this._http.patch(`pages/${pageId}`, { properties: props });
    return this._pageToTask(resp.data);
  }

  async markDone({ pageId }) {
    return await this.updateStatus({ pageId, status: 'Done' });
  }

  async updateStatus({ pageId, status }) {
    const schema = await this._ensureSchema();
    if (!this._hasProp(schema, 'Status')) throw new Error('DB has no Status property');
    const resp = await this._http.patch(`pages/${pageId}`, { properties: { Status: { status: { name: status } } } });
    return this._pageToTask(resp.data);
  }

  async moveToDeprecated({ pageId }) {
    // "Delete" means moving to Deprecated tag.
    return await this.updateTags({ pageId, tag: 'Deprecated' });
  }

  async updateTags({ pageId, tag }) {
    const schema = await this._ensureSchema();
    if (!this._hasProp(schema, 'Tags')) throw new Error('DB has no Tags property');
    const resp = await this._http.patch(`pages/${pageId}`, { properties: { Tags: { multi_select: tag ? [{ name: tag }] : [] } } });
    return this._pageToTask(resp.data);
  }

  async appendDescription({ pageId, text }) {
    const content = String(text || '').trim();
    if (!content) return { ok: true };
    // Append a paragraph block to the page.
    await this._http.patch(`blocks/${pageId}/children`, {
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content } }],
          },
        },
      ],
    });
    return { ok: true };
  }

  async findTasks({ queryText, limit = 20 } = {}) {
    const tasks = await this.listTasks({ queryText, limit: Math.min(Number(limit) || 20, 100) });
    return tasks;
  }

  _pageToTask(page) {
    const props = page.properties || {};
    const titleParts = props.Name?.title || [];
    const title = titleParts.map((p) => p.plain_text || '').join('').trim();
    const tags = (props.Tags?.multi_select || []).map((t) => t.name).filter(Boolean);
    return {
      id: page.id,
      url: page.url,
      title,
      status: props.Status?.status?.name || null,
      priority: props.Priority?.select?.name || null,
      dueDate: props['Due Date']?.date?.start || null,
      pmd: typeof props.PMD?.number === 'number' ? props.PMD.number : null,
      tags,
    };
  }
}

module.exports = { NotionTasksRepo };


