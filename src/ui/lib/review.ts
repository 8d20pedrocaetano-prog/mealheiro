/** The review inbox, computed once per model (Shell badge, Home and the inbox screen share it). */
import type { Model } from '../../core/model';
import { countsForBadge, reviewCards, type ReviewCard } from '../../core/review';

const cache = new WeakMap<Model, ReviewCard[]>();

export function cardsOf(m: Model): ReviewCard[] {
  let c = cache.get(m);
  if (!c) cache.set(m, (c = reviewCards(m)));
  return c;
}

export const badgeCount = (m: Model) => cardsOf(m).filter(countsForBadge).length;
