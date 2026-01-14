const { createNotionHttpClient } = require('./client');

class NotionIdeasRepo {
  constructor({ notionToken, databaseId, eventLogRepo = null }) {
    this._dbId = databaseId;
    this._http = createNotionHttpClient({ notionToken, eventLogRepo, component: 'notion' });
    this._schema = null;
  }

  _normalizeOptionKey(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '')
      .trim();
  }

  _uniqNames(names) {
    const arr = (Array.isArray(names) ? names : [names])
      .map((x) => String(x || '').trim())
      .filter(Boolean);
    const out = [];
    const seen = new Set();
    for (const n of arr) {
      const k = this._normalizeOptionKey(n);
      if (!k) continue;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(n);
    }
    return out;
  }

  async getDatabase() {
    const resp = await this._http.get(`databases/${this._dbId}`);
    return resp.data;
  }

  _richTextToPlainText(richTextArr) {
    const arr = Array.isArray(richTextArr) ? richTextArr : [];
    return arr.map((t) => t.plain_text || '').join('').trim();
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
    const area =
      db.properties?.Area?.select?.options?.map((o) => o.name) ||
      db.properties?.Area?.multi_select?.options?.map((o) => o.name) ||
      [];
    const tags =
      db.properties?.Tags?.multi_select?.options?.map((o) => o.name) ||
      db.properties?.Tags?.select?.options?.map((o) => o.name) ||
      [];
    const areaType = db.properties?.Area?.type || null;
    const tagsType = db.properties?.Tags?.type || null;
    const project =
      db.properties?.Project?.select?.options?.map((o) => o.name) ||
      db.properties?.Project?.multi_select?.options?.map((o) => o.name) ||
      [];
    const projectType = db.properties?.Project?.type || null;
    return { category, priority, status, area, tags, project, areaType, tagsType, projectType };
  }

  async _ensureSelectOptions({ propertyName, desiredNames }) {
    const want = this._uniqNames(desiredNames);
    if (!want.length) return { added: [], resolved: [] };

    const db = await this.getDatabase();
    const prop = db.properties?.[propertyName];
    const current = prop?.select?.options || [];
    const byKey = new Map(current.map((o) => [this._normalizeOptionKey(o.name), o]));

    const toAdd = [];
    for (const name of want) {
      const key = this._normalizeOptionKey(name);
      if (!key) continue;
      if (byKey.has(key)) continue;
      toAdd.push({ name, color: 'default' });
    }

    if (!toAdd.length) {
      const resolved = want.map((n) => byKey.get(this._normalizeOptionKey(n))?.name || n);
      return { added: [], resolved };
    }

    const merged = [
      ...current.map((o) => ({ id: o.id, name: o.name, color: o.color || 'default' })),
      ...toAdd,
    ];
    const seen = new Set();
    const options = [];
    for (const o of merged) {
      const key = this._normalizeOptionKey(o.name);
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      const out = { name: o.name, color: o.color || 'default' };
      if (o.id) out.id = o.id;
      options.push(out);
    }

    await this._http.patch(`databases/${this._dbId}`, {
      properties: {
        [propertyName]: { select: { options } },
      },
    });
    this._schema = null;

    const db2 = await this.getDatabase();
    const current2 = db2.properties?.[propertyName]?.select?.options || [];
    const byKey2 = new Map(current2.map((o) => [this._normalizeOptionKey(o.name), o]));
    const resolved = want.map((n) => byKey2.get(this._normalizeOptionKey(n))?.name || n);
    return { added: toAdd.map((x) => x.name), resolved };
  }

  async _ensureMultiSelectOptions({ propertyName, desiredNames }) {
    const want = this._uniqNames(desiredNames);
    if (!want.length) return { added: [], resolved: [] };

    const db = await this.getDatabase();
    const prop = db.properties?.[propertyName];
    const current = prop?.multi_select?.options || [];
    const byKey = new Map(current.map((o) => [this._normalizeOptionKey(o.name), o]));

    const toAdd = [];
    for (const name of want) {
      const key = this._normalizeOptionKey(name);
      if (!key) continue;
      if (byKey.has(key)) continue;
      toAdd.push({ name, color: 'default' });
    }

    if (!toAdd.length) {
      const resolved = want.map((n) => byKey.get(this._normalizeOptionKey(n))?.name || n);
      return { added: [], resolved };
    }

    const merged = [
      ...current.map((o) => ({ id: o.id, name: o.name, color: o.color || 'default' })),
      ...toAdd,
    ];
    const seen = new Set();
    const options = [];
    for (const o of merged) {
      const key = this._normalizeOptionKey(o.name);
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      const out = { name: o.name, color: o.color || 'default' };
      if (o.id) out.id = o.id;
      options.push(out);
    }

    await this._http.patch(`databases/${this._dbId}`, {
      properties: {
        [propertyName]: { multi_select: { options } },
      },
    });
    this._schema = null;

    const db2 = await this.getDatabase();
    const current2 = db2.properties?.[propertyName]?.multi_select?.options || [];
    const byKey2 = new Map(current2.map((o) => [this._normalizeOptionKey(o.name), o]));
    const resolved = want.map((n) => byKey2.get(this._normalizeOptionKey(n))?.name || n);
    return { added: toAdd.map((x) => x.name), resolved };
  }

  async ensureAreaOptions({ desiredNames }) {
    const want = this._uniqNames(desiredNames);
    if (!want.length) return { added: [], resolved: [] };

    const db = await this.getDatabase();
    const prop = db.properties?.Area;
    const type = prop?.type || null;

    if (type === 'select') return await this._ensureSelectOptions({ propertyName: 'Area', desiredNames: want });
    if (type === 'multi_select') return await this._ensureMultiSelectOptions({ propertyName: 'Area', desiredNames: want });

    // For rich_text (or missing Area), we cannot add options.
    return { added: [], resolved: want };
  }

  async ensureTagsOptions({ desiredNames }) {
    const want = this._uniqNames(desiredNames);
    if (!want.length) return { added: [], resolved: [] };

    const db = await this.getDatabase();
    const prop = db.properties?.Tags;
    const type = prop?.type || null;

    if (type === 'select') return await this._ensureSelectOptions({ propertyName: 'Tags', desiredNames: want });
    if (type === 'multi_select') return await this._ensureMultiSelectOptions({ propertyName: 'Tags', desiredNames: want });

    return { added: [], resolved: want };
  }

  async ensureProjectOptions({ desiredNames }) {
    const want = this._uniqNames(desiredNames);
    if (!want.length) return { added: [], resolved: [] };

    const db = await this.getDatabase();
    const prop = db.properties?.Project;
    const type = prop?.type || null;

    if (type === 'select') return await this._ensureSelectOptions({ propertyName: 'Project', desiredNames: want });
    if (type === 'multi_select') return await this._ensureMultiSelectOptions({ propertyName: 'Project', desiredNames: want });

    return { added: [], resolved: want };
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

  _propType(schema, name) {
    return schema?.[name]?.type || null;
  }

  async createIdea({ title, category, status, priority, source, area, tags, project }) {
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
      const s = String(status || '').trim();
      if (s) props.Status = { status: { name: s } };
    }
    if (source !== undefined && this._hasProp(schema, 'Source')) {
      const s = String(source || '').trim();
      props.Source = { rich_text: s ? [{ type: 'text', text: { content: s } }] : [] };
    }
    if (area !== undefined && this._hasProp(schema, 'Area')) {
      const t = this._propType(schema, 'Area');
      const a = String(area || '').trim();
      if (t === 'select') props.Area = { select: a ? { name: a } : null };
      else if (t === 'multi_select') props.Area = { multi_select: a ? [{ name: a }] : [] };
      else if (t === 'rich_text') props.Area = { rich_text: a ? [{ type: 'text', text: { content: a } }] : [] };
    }
    if (tags !== undefined && this._hasProp(schema, 'Tags')) {
      const t = this._propType(schema, 'Tags');
      const arr = Array.isArray(tags) ? tags : tags ? [tags] : [];
      if (t === 'multi_select') props.Tags = { multi_select: arr.filter(Boolean).map((x) => ({ name: x })) };
      else if (t === 'select') props.Tags = { select: arr[0] ? { name: arr[0] } : null };
    }
    if (project !== undefined && this._hasProp(schema, 'Project')) {
      const t = this._propType(schema, 'Project');
      const p = String(project || '').trim();
      if (t === 'select') props.Project = { select: p ? { name: p } : null };
      else if (t === 'multi_select') props.Project = { multi_select: p ? [{ name: p }] : [] };
      else if (t === 'rich_text') props.Project = { rich_text: p ? [{ type: 'text', text: { content: p } }] : [] };
    }

    const resp = await this._http.post('pages', {
      parent: { database_id: this._dbId },
      properties: props,
    });
    return this._pageToIdea(resp.data);
  }

  async updateIdea({ pageId, title, category, status, priority, source, area, tags, project }) {
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
    if (area !== undefined && this._hasProp(schema, 'Area')) {
      const t = this._propType(schema, 'Area');
      const a = String(area || '').trim();
      if (t === 'select') props.Area = { select: a ? { name: a } : null };
      else if (t === 'multi_select') props.Area = { multi_select: a ? [{ name: a }] : [] };
      else if (t === 'rich_text') props.Area = { rich_text: a ? [{ type: 'text', text: { content: a } }] : [] };
    }
    if (tags !== undefined && this._hasProp(schema, 'Tags')) {
      const t = this._propType(schema, 'Tags');
      const arr = Array.isArray(tags) ? tags : tags ? [tags] : [];
      if (t === 'multi_select') {
        if (tags === null) props.Tags = { multi_select: [] };
        else props.Tags = { multi_select: arr.filter(Boolean).map((x) => ({ name: x })) };
      } else if (t === 'select') {
        if (tags === null) props.Tags = { select: null };
        else props.Tags = { select: arr[0] ? { name: arr[0] } : null };
      }
    }
    if (project !== undefined && this._hasProp(schema, 'Project')) {
      const t = this._propType(schema, 'Project');
      const p = String(project || '').trim();
      if (t === 'select') props.Project = { select: p ? { name: p } : null };
      else if (t === 'multi_select') props.Project = { multi_select: p ? [{ name: p }] : [] };
      else if (t === 'rich_text') props.Project = { rich_text: p ? [{ type: 'text', text: { content: p } }] : [] };
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

  async getIdea({ pageId }) {
    const resp = await this._http.get(`pages/${String(pageId)}`);
    return this._pageToIdea(resp.data);
  }

  _pageToIdea(page) {
    const props = page.properties || {};
    const titleParts = props.Idea?.title || [];
    const title = titleParts.map((p) => p.plain_text || '').join('').trim();
    const categories = (props.Category?.multi_select || []).map((t) => t.name).filter(Boolean);
    const area = props.Area?.select?.name || this._richTextToPlainText(props.Area?.rich_text) || null;
    const tags = (props.Tags?.multi_select || []).map((t) => t.name).filter(Boolean);
    const project =
      props.Project?.select?.name ||
      (props.Project?.multi_select || []).map((t) => t.name).filter(Boolean) ||
      this._richTextToPlainText(props.Project?.rich_text) ||
      null;
    return {
      id: page.id,
      url: page.url,
      title,
      status: props.Status?.status?.name || null,
      priority: props.Priority?.select?.name || null,
      categories,
      area,
      tags,
      project,
    };
  }
}

module.exports = { NotionIdeasRepo };



