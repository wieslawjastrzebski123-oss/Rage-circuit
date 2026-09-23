import type { AbilityId } from '../data/cars';
import type { Ability } from './Ability';
import { Blink } from './Blink';
import { EMP } from './EMP';
import { Nitro } from './Nitro';
import { Shield } from './Shield';

export function createAbility(id: AbilityId): Ability {
  switch (id) {
    case 'nitro':
      return new Nitro();
    case 'shield':
      return new Shield();
    case 'blink':
      return new Blink();
    case 'emp':
      return new EMP();
  }
}
