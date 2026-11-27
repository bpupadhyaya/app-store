// Pricing label for a NEW catalog entry, taken only from the app's own public store description.
// A subscription alone never means "with ads". When the text does not say, the label points to the store listing.
const NO_ADS = /\b(no|without|free of|zero)\s+(third[- ]party\s+)?(ads|adverts|advertising)\b|\bad-free for everyone\b/gi;
const ADS = /\b(ads|adverts|advertising|admob|rewarded|ad-free|ad-supported)\b/i;
const ONE_TIME = /one[- ]time[^.\n]{0,40}remove ads|remove ads[^.\n]{0,40}(one[- ]time|purchase)|one purchase removes/i;
export const UNKNOWN = 'Free; see the store listing for ads and subscription details';

export function monetizationFor(description, { education = false } = {}) {
  const d = description || '', noAds = d.search(NO_ADS) > -1, ads = ADS.test(d.replace(NO_ADS, ' '));
  const monthly = /\bmonthly\b|\ba month\b|\bper month\b|\/month/i.test(d), sub = /subscri/i.test(d);
  if (ads) return ONE_TIME.test(d) ? 'Free with ads, optional one-time Remove Ads' : sub && monthly ? 'Free with ads, optional monthly ad-free' : 'Free with ads';
  if (/\bPlus\b/.test(d) && monthly) return education ? 'Free core course, optional monthly Plus' : 'Free, optional monthly Plus';
  if (noAds) return sub ? `Free, no ads, optional ${monthly ? 'monthly ' : ''}subscription` : 'Free, no ads';
  return UNKNOWN;
}
