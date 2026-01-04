const { createNotionHttpClient } = require('./client');

class NotionJournalRepo {
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

  async getEntry({ pageId }) {
    const resp = await this._http.get(`pages/${String(pageId)}`);
    return this._pageToEntry(resp.data);
  }

  _richTextToPlainText(richTextArr) {
    const arr = Array.isArray(richTextArr) ? richTextArr : [];
    return arr.map((t) => t.plain_text || '').join('').trim();
  }

  async getEntryContentText({ pageId, limitChars = 2000 }) {
    const blockId = String(pageId);
    let cursor = null;
    let out = '';

    const append = (s) => {
      const text = String(s || '').trim();
      if (!text) return;
      if (out.length) out += '\n';
      out += text;
    };

    while (out.length < limitChars) {
      const params = new URLSearchParams();
      params.set('page_size', '50');
      if (cursor) params.set('start_cursor', cursor);

      const resp = await this._http.get(`blocks/${blockId}/children?${params.toString()}`);
      const results = resp.data?.results || [];
      for (const b of results) {
        if (!b || !b.type) continue;
        const type = b.type;
        const node = b[type] || {};

        if (type === 'paragraph' || type === 'quote' || type === 'callout') {
          append(this._richTextToPlainText(node.rich_text));
        } else if (type === 'heading_1' || type === 'heading_2' || type === 'heading_3') {
          append(this._richTextToPlainText(node.rich_text));
        } else if (type === 'bulleted_list_item' || type === 'numbered_list_item' || type === 'to_do') {
          append(this._richTextToPlainText(node.rich_text));
        }

        if (out.length >= limitChars) break;
      }

      if (!resp.data?.has_more) break;
      cursor = resp.data?.next_cursor || null;
      if (!cursor) break;
    }

    return out.slice(0, limitChars).trim();
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
    const type = db.properties?.Type?.select?.options?.map((o) => o.name) || [];
    const topics = db.properties?.Topics?.multi_select?.options?.map((o) => o.name) || [];
    const context = db.properties?.Context?.multi_select?.options?.map((o) => o.name) || [];
    return { type, topics, context };
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

  async ensureJournalOptions({ type, topics, context }) {
    const res = { type: null, topics: [], context: [], added: { Type: [], Topics: [], Context: [] } };

    if (type) {
      const r = await this._ensureSelectOptions({ propertyName: 'Type', desiredNames: [type] });
      res.type = r.resolved[0] || null;
      res.added.Type = r.added;
    }
    if (topics && topics.length) {
      const r = await this._ensureMultiSelectOptions({ propertyName: 'Topics', desiredNames: topics });
      res.topics = r.resolved || [];
      res.added.Topics = r.added;
    }
    if (context && context.length) {
      const r = await this._ensureMultiSelectOptions({ propertyName: 'Context', desiredNames: context });
      res.context = r.resolved || [];
      res.added.Context = r.added;
    }

    return res;
  }

  async listEntries({ type, topics, context, dateOnOrAfter, dateBefore, queryText, limit = 20 } = {}) {
    const payload = {
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
      page_size: Math.min(Math.max(1, Number(limit) || 20), 100),
    };

    const filters = [];
    if (type) {
      filters.push({ property: 'Type', select: { equals: type } });
    }
    if (topics) {
      const ts = Array.isArray(topics) ? topics : [topics];
      if (ts.length === 1) {
        filters.push({ property: 'Topics', multi_select: { contains: ts[0] } });
      } else if (ts.length > 1) {
        filters.push({ or: ts.map((t) => ({ property: 'Topics', multi_select: { contains: t } })) });
      }
    }
    if (context) {
      const cs = Array.isArray(context) ? context : [context];
      if (cs.length === 1) {
        filters.push({ property: 'Context', multi_select: { contains: cs[0] } });
      } else if (cs.length > 1) {
        filters.push({ or: cs.map((c) => ({ property: 'Context', multi_select: { contains: c } })) });
      }
    }
    if (dateOnOrAfter || dateBefore) {
      const date = {};
      if (dateOnOrAfter) date.on_or_after = dateOnOrAfter;
      if (dateBefore) date.before = dateBefore;
      filters.push({ property: 'Date', date });
    }
    if (queryText) {
      filters.push({ property: 'Entry', title: { contains: queryText } });
    }

    if (filters.length === 1) payload.filter = filters[0];
    if (filters.length > 1) payload.filter = { and: filters };

    const resp = await this._http.post(`databases/${this._dbId}/query`, payload);
    return (resp.data.results || []).map((p) => this._pageToEntry(p));
  }

  async findEntries({ queryText, limit = 20 } = {}) {
    return await this.listEntries({ queryText, limit });
  }

  async createEntry({ title, date, type, topics, mood, energy, context }) {
    const schema = await this._ensureSchema();
    const props = {};

    if (this._hasProp(schema, 'Entry')) {
      props.Entry = { title: [{ text: { content: String(title || '').trim() } }] };
    }
    if (date !== undefined && this._hasProp(schema, 'Date')) {
      props.Date = { date: date ? { start: String(date) } : null };
    }
    if (type !== undefined && this._hasProp(schema, 'Type')) {
      props.Type = { select: type ? { name: type } : null };
    }
    if (topics !== undefined && this._hasProp(schema, 'Topics')) {
      const ts = Array.isArray(topics) ? topics : topics ? [topics] : [];
      props.Topics = { multi_select: ts.filter(Boolean).map((t) => ({ name: t })) };
    }
    if (mood !== undefined && this._hasProp(schema, 'Mood')) {
      props.Mood = { number: typeof mood === 'number' ? mood : mood ? Number(mood) : null };
    }
    if (energy !== undefined && this._hasProp(schema, 'Energy')) {
      props.Energy = { number: typeof energy === 'number' ? energy : energy ? Number(energy) : null };
    }
    if (context !== undefined && this._hasProp(schema, 'Context')) {
      const cs = Array.isArray(context) ? context : context ? [context] : [];
      props.Context = { multi_select: cs.filter(Boolean).map((c) => ({ name: c })) };
    }

    const resp = await this._http.post('pages', {
      parent: { database_id: this._dbId },
      properties: props,
    });
    return this._pageToEntry(resp.data);
  }

  async updateEntry({ pageId, title, date, type, topics, mood, energy, context }) {
    const schema = await this._ensureSchema();
    const props = {};

    if (title !== undefined && this._hasProp(schema, 'Entry')) {
      const t = String(title || '').trim();
      if (t) props.Entry = { title: [{ text: { content: t } }] };
    }
    if (date !== undefined && this._hasProp(schema, 'Date')) {
      props.Date = { date: date ? { start: String(date) } : null };
    }
    if (type !== undefined && this._hasProp(schema, 'Type')) {
      props.Type = { select: type ? { name: type } : null };
    }
    if (topics !== undefined && this._hasProp(schema, 'Topics')) {
      if (topics === null) props.Topics = { multi_select: [] };
      else {
        const ts = Array.isArray(topics) ? topics : topics ? [topics] : [];
        props.Topics = { multi_select: ts.filter(Boolean).map((t) => ({ name: t })) };
      }
    }
    if (mood !== undefined && this._hasProp(schema, 'Mood')) {
      props.Mood = { number: mood === null ? null : Number(mood) };
    }
    if (energy !== undefined && this._hasProp(schema, 'Energy')) {
      props.Energy = { number: energy === null ? null : Number(energy) };
    }
    if (context !== undefined && this._hasProp(schema, 'Context')) {
      if (context === null) props.Context = { multi_select: [] };
      else {
        const cs = Array.isArray(context) ? context : context ? [context] : [];
        props.Context = { multi_select: cs.filter(Boolean).map((c) => ({ name: c })) };
      }
    }

    if (!Object.keys(props).length) return { id: pageId, title: null, url: null };

    const resp = await this._http.patch(`pages/${pageId}`, { properties: props });
    return this._pageToEntry(resp.data);
  }

  async archiveEntry({ pageId }) {
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

  _pageToEntry(page) {
    const props = page.properties || {};
    const titleParts = props.Entry?.title || [];
    const title = titleParts.map((p) => p.plain_text || '').join('').trim();
    const topics = (props.Topics?.multi_select || []).map((t) => t.name).filter(Boolean);
    const context = (props.Context?.multi_select || []).map((t) => t.name).filter(Boolean);
    return {
      id: page.id,
      url: page.url,
      title,
      date: props.Date?.date?.start || null,
      type: props.Type?.select?.name || null,
      topics,
      context,
      mood: typeof props.Mood?.number === 'number' ? props.Mood.number : null,
      energy: typeof props.Energy?.number === 'number' ? props.Energy.number : null,
    };
  }
}

module.exports = { NotionJournalRepo };


