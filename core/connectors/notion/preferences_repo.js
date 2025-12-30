const { createNotionHttpClient } = require('./client');

function readPlainTextFromRichText(arr) {
  return (arr || []).map((x) => x?.plain_text || '').join('').trim();
}

function toIso(dt) {
  if (!dt) return null;
  const d = dt instanceof Date ? dt : new Date(dt);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toISOString();
}

function richTextValue(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  return [{ type: 'text', text: { content: t } }];
}

class NotionPreferencesRepo {
  constructor({ notionToken, preferencesDbId, profilesDbId }) {
    this._prefsDbId = preferencesDbId;
    this._profilesDbId = profilesDbId;
    this._http = createNotionHttpClient({ notionToken });
  }

  async findPreferencePageByExternalId({ externalId }) {
    const safe = String(externalId || '').trim();
    if (!safe) return null;
    if (!this._prefsDbId) throw new Error('Preferences DB id missing');

    const resp = await this._http.post(`databases/${this._prefsDbId}/query`, {
      page_size: 1,
      filter: { property: 'ExternalId', rich_text: { equals: safe } },
    });
    const page = resp.data.results && resp.data.results[0] ? resp.data.results[0] : null;
    return page ? { pageId: page.id, page } : null;
  }

  async upsertPreferencePage({
    externalId,
    chatId,
    scope,
    category,
    key,
    active,
    valueHuman,
    valueJson,
    syncHash,
    lastSource,
    updatedAt,
  }) {
    if (!this._prefsDbId) throw new Error('Preferences DB id missing');
    const safeExternalId = String(externalId || '').trim();
    const safeKey = String(key || '').trim();
    if (!safeExternalId) throw new Error('externalId is required');
    if (!safeKey) throw new Error('key is required');

    const safeChatId = typeof chatId === 'number' ? chatId : Number(chatId);
    if (!Number.isFinite(safeChatId)) throw new Error('chatId is required');

    const props = {
      Key: { title: [{ type: 'text', text: { content: safeKey } }] },
      ExternalId: { rich_text: [{ type: 'text', text: { content: safeExternalId } }] },
      ChatId: { number: safeChatId },
      Active: { checkbox: Boolean(active) },
      ValueHuman: { rich_text: richTextValue(valueHuman) },
      ValueJson: { rich_text: richTextValue(valueJson) },
      SyncHash: { rich_text: richTextValue(syncHash) },
      UpdatedAt: { date: updatedAt ? { start: String(updatedAt) } : null },
    };

    if (scope) props.Scope = { select: { name: String(scope) } };
    if (category) props.Category = { select: { name: String(category) } };
    if (lastSource) props.LastSource = { select: { name: String(lastSource) } };

    const found = await this.findPreferencePageByExternalId({ externalId: safeExternalId });
    if (found && found.pageId) {
      const resp = await this._http.patch(`pages/${found.pageId}`, { properties: props });
      return { pageId: found.pageId, page: resp.data, created: false };
    }

    const resp = await this._http.post('pages', {
      parent: { database_id: this._prefsDbId },
      properties: props,
    });
    return { pageId: resp.data.id, page: resp.data, created: true };
  }

  async listPreferencesEditedSince({ sinceIso = null, pageSize = 100, startCursor = null } = {}) {
    if (!this._prefsDbId) throw new Error('Preferences DB id missing');
    const payload = {
      page_size: Math.min(Math.max(1, Number(pageSize) || 100), 100),
      sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
    };
    if (startCursor) payload.start_cursor = String(startCursor);

    if (sinceIso) {
      payload.filter = {
        timestamp: 'last_edited_time',
        last_edited_time: { on_or_after: String(sinceIso) },
      };
    }

    const resp = await this._http.post(`databases/${this._prefsDbId}/query`, payload);
    return {
      results: resp.data.results || [],
      nextCursor: resp.data.next_cursor || null,
      hasMore: Boolean(resp.data.has_more),
    };
  }

  parsePreferencePage(page) {
    const p = page?.properties || {};
    const externalId = readPlainTextFromRichText(p.ExternalId?.rich_text);
    const key = readPlainTextFromRichText(p.Key?.title);
    const valueHuman = readPlainTextFromRichText(p.ValueHuman?.rich_text);
    const valueJson = readPlainTextFromRichText(p.ValueJson?.rich_text);
    const syncHash = readPlainTextFromRichText(p.SyncHash?.rich_text);
    const chatId = typeof p.ChatId?.number === 'number' ? p.ChatId.number : null;
    const scope = p.Scope?.select?.name || null;
    const category = p.Category?.select?.name || null;
    const lastSource = p.LastSource?.select?.name || null;
    const active = typeof p.Active?.checkbox === 'boolean' ? p.Active.checkbox : true;
    const updatedAt = p.UpdatedAt?.date?.start || null;
    const notionEditedAt = toIso(page?.last_edited_time) || null;

    return {
      pageId: page?.id || null,
      archived: Boolean(page?.archived),
      externalId,
      chatId,
      scope,
      category,
      key,
      active,
      valueHuman,
      valueJson,
      syncHash,
      lastSource,
      updatedAt,
      notionEditedAt,
    };
  }

  async findProfilePageByExternalId({ externalId }) {
    const safe = String(externalId || '').trim();
    if (!safe) return null;
    if (!this._profilesDbId) throw new Error('Preference Profiles DB id missing');

    const resp = await this._http.post(`databases/${this._profilesDbId}/query`, {
      page_size: 1,
      filter: { property: 'ExternalId', rich_text: { equals: safe } },
    });
    const page = resp.data.results && resp.data.results[0] ? resp.data.results[0] : null;
    return page ? { pageId: page.id, page } : null;
  }

  async upsertProfilePage({ chatId, externalId, summary, updatedAt }) {
    if (!this._profilesDbId) throw new Error('Preference Profiles DB id missing');
    const safeExternalId = String(externalId || '').trim();
    const safeChatId = typeof chatId === 'number' ? chatId : Number(chatId);
    if (!safeExternalId) throw new Error('externalId is required');
    if (!Number.isFinite(safeChatId)) throw new Error('chatId is required');

    const props = {
      Chat: { title: [{ type: 'text', text: { content: `Chat ${safeChatId}` } }] },
      ExternalId: { rich_text: [{ type: 'text', text: { content: safeExternalId } }] },
      ChatId: { number: safeChatId },
      Summary: { rich_text: richTextValue(summary) },
      UpdatedAt: { date: updatedAt ? { start: String(updatedAt) } : null },
    };

    const found = await this.findProfilePageByExternalId({ externalId: safeExternalId });
    if (found && found.pageId) {
      const resp = await this._http.patch(`pages/${found.pageId}`, { properties: props });
      return { pageId: found.pageId, page: resp.data, created: false };
    }

    const resp = await this._http.post('pages', {
      parent: { database_id: this._profilesDbId },
      properties: props,
    });
    return { pageId: resp.data.id, page: resp.data, created: true };
  }
}

module.exports = { NotionPreferencesRepo };


