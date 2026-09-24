import type { WeaponId } from '../data/weapons';
import { Cannon } from './Cannon';
import { MachineGun } from './MachineGun';
import { MineLayer } from './MineLayer';
import { OilDropper } from './OilDropper';
import { Railgun } from './Railgun';
import { RocketLauncher } from './RocketLauncher';
import { Shotgun } from './Shotgun';
import { SwarmLauncher } from './SwarmLauncher';
import type { Weapon } from './Weapon';

export function createWeapon(id: WeaponId): Weapon {
  switch (id) {
    case 'machinegun':
      return new MachineGun();
    case 'cannon':
      return new Cannon();
    case 'shotgun':
      return new Shotgun();
    case 'railgun':
      return new Railgun();
    case 'swarm':
      return new SwarmLauncher();
    case 'mine':
      return new MineLayer();
    case 'oil':
      return new OilDropper();
    case 'rocket':
    // the hunter is never carried (the HUNTER pickup launches it); a stale loadout gets rockets
    case 'hunter':
      return new RocketLauncher();
  }
}
