const { createNotionHttpClient } = require('./client');

class NotionSocialRepo {
  constructor({ notionToken, databaseId, eventLogRepo = null }) {
    this._dbId = databaseId;
    this._http = createNotionHttpClient({ notionToken, eventLogRepo, component: 'notion' });
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
    const platform = db.properties?.Platform?.multi_select?.options?.map((o) => o.name) || [];
    const contentType = db.properties?.['Content type']?.multi_select?.options?.map((o) => o.name) || [];
    const status = db.properties?.Status?.status?.options?.map((o) => o.name) || [];
    return { platform, contentType, status };
  }

  async listPosts({ platform, status, excludeStatuses = null, requireDate = false, dateOnOrAfter, dateBefore, queryText, limit = 20 } = {}) {
    const payload = {
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: Math.min(Math.max(1, Number(limit) || 20), 100),
    };

    const filters = [];
    if (platform) {
      const plats = Array.isArray(platform) ? platform : [platform];
      if (plats.length === 1) {
        filters.push({ property: 'Platform', multi_select: { contains: plats[0] } });
      } else if (plats.length > 1) {
        filters.push({ or: plats.map((p) => ({ property: 'Platform', multi_select: { contains: p } })) });
      }
    }
    if (status) {
      filters.push({ property: 'Status', status: { equals: status } });
    }
    const excludeArr = Array.isArray(excludeStatuses) ? excludeStatuses.filter(Boolean) : [];
    for (const s of excludeArr) {
      // Notion status filter supports does_not_equal (same as select).
      filters.push({ property: 'Status', status: { does_not_equal: String(s) } });
    }
    if (requireDate) {
      // Exclude drafts without a Post date for "schedule" style list queries.
      filters.push({ property: 'Post date', date: { is_not_empty: true } });
    }
    if (dateOnOrAfter || dateBefore) {
      const date = {};
      if (dateOnOrAfter) date.on_or_after = dateOnOrAfter;
      if (dateBefore) date.before = dateBefore;
      filters.push({ property: 'Post date', date });
    }
    if (queryText) {
      filters.push({ property: 'Post name', title: { contains: queryText } });
    }
    if (filters.length === 1) payload.filter = filters[0];
    if (filters.length > 1) payload.filter = { and: filters };

    const resp = await this._http.post(`databases/${this._dbId}/query`, payload);
    return (resp.data.results || []).map((p) => this._pageToPost(p));
  }

  async createPost({ title, platform, postDate, contentType, status, postUrl }) {
    const schema = await this._ensureSchema();
    const props = {};

    if (this._hasProp(schema, 'Post name')) {
      props['Post name'] = { title: [{ text: { content: String(title || '').trim() } }] };
    }
    if (platform !== undefined && this._hasProp(schema, 'Platform')) {
      const plats = Array.isArray(platform) ? platform : platform ? [platform] : [];
      props.Platform = { multi_select: plats.filter(Boolean).map((p) => ({ name: p })) };
    }
    if (postDate !== undefined && this._hasProp(schema, 'Post date')) {
      props['Post date'] = { date: postDate ? { start: String(postDate) } : null };
    }
    if (contentType !== undefined && this._hasProp(schema, 'Content type')) {
      const types = Array.isArray(contentType) ? contentType : contentType ? [contentType] : [];
      props['Content type'] = { multi_select: types.filter(Boolean).map((t) => ({ name: t })) };
    }
    if (status !== undefined && this._hasProp(schema, 'Status')) {
      props.Status = { status: { name: status || 'Post Idea' } };
    }
    if (postUrl !== undefined && this._hasProp(schema, 'Post URL')) {
      props['Post URL'] = { url: postUrl ? String(postUrl) : null };
    }

    const resp = await this._http.post('pages', {
      parent: { database_id: this._dbId },
      properties: props,
    });
    return this._pageToPost(resp.data);
  }

  async updatePost({ pageId, title, platform, postDate, contentType, status, postUrl }) {
    const schema = await this._ensureSchema();
    const props = {};

    if (title !== undefined && this._hasProp(schema, 'Post name')) {
      const t = String(title || '').trim();
      if (t) props['Post name'] = { title: [{ text: { content: t } }] };
    }
    if (platform !== undefined && this._hasProp(schema, 'Platform')) {
      if (platform === null) props.Platform = { multi_select: [] };
      else {
        const plats = Array.isArray(platform) ? platform : platform ? [platform] : [];
        props.Platform = { multi_select: plats.filter(Boolean).map((p) => ({ name: p })) };
      }
    }
    if (postDate !== undefined && this._hasProp(schema, 'Post date')) {
      props['Post date'] = { date: postDate ? { start: String(postDate) } : null };
    }
    if (contentType !== undefined && this._hasProp(schema, 'Content type')) {
      if (contentType === null) props['Content type'] = { multi_select: [] };
      else {
        const types = Array.isArray(contentType) ? contentType : contentType ? [contentType] : [];
        props['Content type'] = { multi_select: types.filter(Boolean).map((t) => ({ name: t })) };
      }
    }
    if (status !== undefined && this._hasProp(schema, 'Status')) {
      const s = typeof status === 'string' ? status.trim() : '';
      if (s) props.Status = { status: { name: s } };
    }
    if (postUrl !== undefined && this._hasProp(schema, 'Post URL')) {
      props['Post URL'] = { url: postUrl ? String(postUrl) : null };
    }

    if (!Object.keys(props).length) return { id: pageId, title: null, url: null };

    const resp = await this._http.patch(`pages/${pageId}`, { properties: props });
    return this._pageToPost(resp.data);
  }

  async archivePost({ pageId }) {
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
          paragraph: { rich_text: [{ type: 'text', text: { content } }] },
        },
      ],
    });
    return { ok: true };
  }

  _pageToPost(page) {
    const props = page.properties || {};
    const titleParts = props['Post name']?.title || [];
    const title = titleParts.map((p) => p.plain_text || '').join('').trim();
    const platform = (props.Platform?.multi_select || []).map((t) => t.name).filter(Boolean);
    const contentType = (props['Content type']?.multi_select || []).map((t) => t.name).filter(Boolean);
    return {
      id: page.id,
      url: page.url,
      title,
      status: props.Status?.status?.name || null,
      postDate: props['Post date']?.date?.start || null,
      platform,
      contentType,
      postUrl: props['Post URL']?.url || null,
    };
  }
}

module.exports = { NotionSocialRepo };



