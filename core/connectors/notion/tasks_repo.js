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

  async listTasks() {
    const resp = await this._http.post(`databases/${this._dbId}/query`, {
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    });
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


