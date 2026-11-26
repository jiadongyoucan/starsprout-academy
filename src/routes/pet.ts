import type { Router } from '../core/http.ts';
import type { Db } from '../infra/db.ts';
import { adoptPet, buyItem, equipItem, interactPet, petView } from '../modules/pet.ts';

export function registerPetRoutes(router: Router, db: Db): void {
  router.get('/api/pet', 'user', ctx => petView(db, ctx.user!, ctx.query.get('childId')));
  router.post('/api/pet/adopt', 'user', ctx => adoptPet(db, ctx.user!, ctx.body), { max: 10, windowMs: 10 * 60_000, key: 'pet-adopt' });
  router.post('/api/pet/interact', 'user', ctx => interactPet(db, ctx.user!, ctx.body), { max: 60, windowMs: 10 * 60_000, key: 'pet-interact' });
  router.post('/api/pet/shop/buy', 'user', ctx => buyItem(db, ctx.user!, ctx.body), { max: 40, windowMs: 10 * 60_000, key: 'pet-buy' });
  router.post('/api/pet/equip', 'user', ctx => equipItem(db, ctx.user!, ctx.body));
}
