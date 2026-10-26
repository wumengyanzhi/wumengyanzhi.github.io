import { SAVE_KEY } from '../persistence';
import { TUTORIAL_KEY } from '../tutorial';

export const ONBOARDING_KEY = 'five-arrays-v2-onboarding-choice';

export function shouldOfferTutorial(storage: Pick<Storage, 'getItem'>): boolean {
  try {
    const choice = storage.getItem(ONBOARDING_KEY);
    if (choice === 'accepted' || choice === 'declined') return false;
    if (storage.getItem(SAVE_KEY) || storage.getItem(TUTORIAL_KEY)) return false;
    const history: unknown = JSON.parse(storage.getItem('five-arrays-v2-history') ?? '[]');
    return !Array.isArray(history) || history.length === 0;
  } catch { return true; }
}
