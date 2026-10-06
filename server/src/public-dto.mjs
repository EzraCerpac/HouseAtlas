import { safeWebUrl } from '../../web/src/model.mjs';
import { fail } from './common.mjs';

/** Configuration is private even when its home is authorized. */
export const publicHome = home => ({workspaceId:home.workspaceId,homeId:home.homeId,label:home.label});

export function publicAttachment(attachment) {
  if(attachment.kind!=='external-link')return structuredClone(attachment);
  // Validate with the accepted URL policy, but retain the exact destination;
  // URL normalization must not rewrite a provider's reference.
  return {...structuredClone(attachment),url:safeWebUrl(attachment.url)?attachment.url:null};
}

export function publicAtlasView(view) {
  return {...view,homes:view.homes.map(publicHome),entries:view.entries.map(entry=>({
    ...entry,attachments:entry.attachments.map(publicAttachment),
  }))};
}

/** Canonical projections cannot carry null URLs. Fail the read page explicitly
 * rather than returning an invalid projection or silently hiding inventory. */
export function publicHomeboxProjection(projection) {
  if(projection.attachments.some(a=>a.kind==='external-link'&&!safeWebUrl(a.url)))fail('upstream-incomplete');
  return structuredClone(projection);
}
