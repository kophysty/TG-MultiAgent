const { createNotionHttpClient } = require('./client');

class NotionIdeasRepo {
  constructor({ notionToken, databaseId }) {
    this._dbId = databaseId;
    this._http = createNotionHttpClient({ notionToken });
    this._schema = null;
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
    const category = db.properties?.Category?.multi_select?.options?.map((o) => o.name) || [];
    const priority = db.properties?.Priority?.select?.options?.map((o) => o.name) || [];
    const status = db.properties?.Status?.status?.options?.map((o) => o.name) || [];
    return { category, priority, status };
  }

  async listIdeas({ category, status, queryText, limit = 20 } = {}) {
    const payload = {
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: Math.min(Math.max(1, Number(limit) || 20), 100),
    };

    const filters = [];
    if (category) {
      const cats = Array.isArray(category) ? category : [category];
      if (cats.length === 1) {
        filters.push({ property: 'Category', multi_select: { contains: cats[0] } });
      } else if (cats.length > 1) {
        filters.push({
          or: cats.map((c) => ({ property: 'Category', multi_select: { contains: c } })),
        });
      }
    }
    if (status) {
      filters.push({ property: 'Status', status: { equals: status } });
    }
    if (queryText) {
      filters.push({ property: 'Idea', title: { contains: queryText } });
    }
    if (filters.length === 1) payload.filter = filters[0];
    if (filters.length > 1) payload.filter = { and: filters };

    const resp = await this._http.post(`databases/${this._dbId}/query`, payload);
    return (resp.data.results || []).map((p) => this._pageToIdea(p));
  }

  async createIdea({ title, category, status, priority, source }) {
    const schema = await this._ensureSchema();
    const props = {};

    if (this._hasProp(schema, 'Idea')) {
      props.Idea = { title: [{ text: { content: String(title || '').trim() } }] };
    }
    if (category !== undefined && this._hasProp(schema, 'Category')) {
      const cats = Array.isArray(category) ? category : category ? [category] : [];
      props.Category = { multi_select: cats.filter(Boolean).map((c) => ({ name: c })) };
    }
    if (priority !== undefined && this._hasProp(schema, 'Priority')) {
      props.Priority = { select: priority ? { name: priority } : null };
    }
    if (status !== undefined && this._hasProp(schema, 'Status')) {
      props.Status = { status: { name: status || 'Inbox' } };
    }
    if (source !== undefined && this._hasProp(schema, 'Source')) {
      const s = String(source || '').trim();
      props.Source = { rich_text: s ? [{ type: 'text', text: { content: s } }] : [] };
    }

    const resp = await this._http.post('pages', {
      parent: { database_id: this._dbId },
      properties: props,
    });
    return this._pageToIdea(resp.data);
  }

  async updateIdea({ pageId, title, category, status, priority, source }) {
    const schema = await this._ensureSchema();
    const props = {};

    if (title !== undefined && this._hasProp(schema, 'Idea')) {
      const t = String(title || '').trim();
      if (t) props.Idea = { title: [{ text: { content: t } }] };
    }
    if (category !== undefined && this._hasProp(schema, 'Category')) {
      if (category === null) props.Category = { multi_select: [] };
      else {
        const cats = Array.isArray(category) ? category : category ? [category] : [];
        props.Category = { multi_select: cats.filter(Boolean).map((c) => ({ name: c })) };
      }
    }
    if (priority !== undefined && this._hasProp(schema, 'Priority')) {
      props.Priority = { select: priority ? { name: priority } : null };
    }
    if (status !== undefined && this._hasProp(schema, 'Status')) {
      const s = typeof status === 'string' ? status.trim() : '';
      if (s) props.Status = { status: { name: s } };
    }
    if (source !== undefined && this._hasProp(schema, 'Source')) {
      const s = String(source || '').trim();
      props.Source = { rich_text: s ? [{ type: 'text', text: { content: s } }] : [] };
    }

    if (!Object.keys(props).length) {
      return { id: pageId, title: null, status: null, priority: null, categories: [], url: null };
    }

    const resp = await this._http.patch(`pages/${pageId}`, { properties: props });
    return this._pageToIdea(resp.data);
  }

  async archiveIdea({ pageId }) {
    await this._http.patch(`pages/${pageId}`, { archived: true });
    return { ok: true };
  }

  async appendDescription({ pageId, text }) {
    const content = String(text || '').trim();
    if (!content) return { ok: true };
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

  _pageToIdea(page) {
    const props = page.properties || {};
    const titleParts = props.Idea?.title || [];
    const title = titleParts.map((p) => p.plain_text || '').join('').trim();
    const categories = (props.Category?.multi_select || []).map((t) => t.name).filter(Boolean);
    return {
      id: page.id,
      url: page.url,
      title,
      status: props.Status?.status?.name || null,
      priority: props.Priority?.select?.name || null,
      categories,
    };
  }
}

module.exports = { NotionIdeasRepo };


