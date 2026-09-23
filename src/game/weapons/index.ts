import type { WeaponId } from '../data/weapons';
import { Cannon } from './Cannon';
import { MachineGun } from './MachineGun';
import { MineLayer } from './MineLayer';
import { RocketLauncher } from './RocketLauncher';
import type { Weapon } from './Weapon';

export function createWeapon(id: WeaponId): Weapon {
  switch (id) {
    case 'machinegun':
      return new MachineGun();
    case 'cannon':
      return new Cannon();
    case 'rocket':
      return new RocketLauncher();
    case 'mine':
      return new MineLayer();
  }
}
