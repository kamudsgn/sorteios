import { AppError } from '../errors.js';
import { shortcodeFromPermalink } from './url.js';

const MEDIA_FIELDS = 'id,shortcode,permalink,caption,media_type,media_product_type,thumbnail_url,media_url,timestamp,comments_count,like_count,username';
const MEDIA_FIELDS_FALLBACK = 'id,permalink,caption,media_type,thumbnail_url,media_url,timestamp,comments_count,username';
const COMMENT_FIELDS = 'id,text,timestamp,username,like_count';
const PAGE_LIMIT = 50;

/**
 * Encontra a mídia do link entre as publicações da conta conectada.
 * A API oficial só dá acesso a comentários de mídias da própria conta profissional.
 */
export async function resolveMedia(client, parsed, account, onProgress = () => {}) {
  if (parsed.username && account?.username && parsed.username !== account.username.toLowerCase()) {
    throw notInAccount(parsed, account);
  }

  let scanned = 0;
  const scan = async (fields) => {
    for await (const page of client.paginate(`${client.accountPath}/media`, { fields, limit: 100 })) {
      for (const m of page) {
        scanned++;
        const code = m.shortcode || shortcodeFromPermalink(m.permalink);
        if (code === parsed.shortcode) return m;
      }
      onProgress({ phase: 'resolving', message: `Procurando a publicação na conta (${scanned} mídias verificadas)…`, scannedMedia: scanned });
    }
    return null;
  };

  let media;
  try {
    media = await scan(MEDIA_FIELDS);
  } catch (err) {
    // Algumas variantes da API não expõem `shortcode`/`media_product_type`: tenta sem eles.
    if (err.code !== 'GRAPH_ERROR' || err.details?.graphCode !== 100) throw err;
    scanned = 0;
    media = await scan(MEDIA_FIELDS_FALLBACK);
  }
  if (!media) throw notInAccount(parsed, account);
  return media;
}

function notInAccount(parsed, account) {
  return new AppError(
    'MEDIA_NOT_ACCESSIBLE',
    `Esta publicação não pertence à conta conectada${account?.username ? ` (@${account.username})` : ''}.`,
    {
      status: 404,
      hint:
        'A API oficial do Instagram só libera comentários de publicações da própria conta profissional conectada. ' +
        'Conecte a conta dona da publicação ou use "Importar lista" com os comentários exportados por ela.',
      details: { shortcode: parsed.shortcode, linkUsername: parsed.username || undefined },
    },
  );
}

/**
 * Coleta todos os comentários e respostas de uma mídia, seguindo toda a paginação.
 * Retorna comentários únicos (deduplicados por id).
 */
export async function collectComments(client, mediaId, onProgress = () => {}) {
  const byId = new Map();
  const counts = { comments: 0, replies: 0, pages: 0, skipped: 0 };

  const add = (c, parentId) => {
    if (!c?.id || byId.has(c.id)) return false;
    if (!c.username) {
      counts.skipped++;
      return false;
    }
    byId.set(c.id, {
      id: String(c.id),
      username: String(c.username),
      text: String(c.text ?? ''),
      timestamp: c.timestamp || null,
      parentId: parentId ? String(parentId) : null,
      likeCount: Number(c.like_count || 0),
    });
    if (parentId) counts.replies++;
    else counts.comments++;
    return true;
  };

  const report = () =>
    onProgress({
      phase: 'collecting',
      message: `Coletando comentários… ${counts.comments} comentários e ${counts.replies} respostas`,
      ...counts,
    });

  const fields = `${COMMENT_FIELDS},replies{${COMMENT_FIELDS}}`;
  for await (const page of client.paginate(`${mediaId}/comments`, { fields, limit: PAGE_LIMIT })) {
    counts.pages++;
    for (const comment of page) {
      add(comment, null);
      // Respostas vêm embutidas; se houver mais páginas de respostas, segue a paginação.
      let replies = comment.replies;
      while (replies) {
        for (const r of replies.data || []) add(r, comment.id);
        replies = replies.paging?.next ? await client.getNext(replies.paging.next) : null;
      }
    }
    report();
  }

  return { comments: [...byId.values()], counts };
}

export function mediaSummary(media, account) {
  return {
    id: String(media.id),
    shortcode: media.shortcode || shortcodeFromPermalink(media.permalink),
    permalink: media.permalink,
    caption: media.caption || '',
    mediaType: media.media_type,
    productType: media.media_product_type || null,
    thumbnailUrl: media.thumbnail_url || (media.media_type !== 'VIDEO' ? media.media_url : null) || null,
    timestamp: media.timestamp || null,
    reportedCommentsCount: typeof media.comments_count === 'number' ? media.comments_count : null,
    likeCount: typeof media.like_count === 'number' ? media.like_count : null,
    ownerUsername: media.username || account?.username || null,
  };
}
