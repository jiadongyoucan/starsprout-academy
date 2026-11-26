import fs from 'node:fs';
import type { Router } from '../core/http.ts';
import type { Db } from '../infra/db.ts';
import {
  ackPush, completeLessonOnDevice, createPairingCode, deleteSnapshot, deviceInbox, deviceLesson, devicePlan, deviceProfile,
  endLearning, listDevices, listSnapshots, openDeviceStream, pairDevice, purgeChildSnapshots,
  pushPlan, requestPhoto, revokeDevice, saveSnapshot, snapshotFile, startLearning, verifyDeviceParent,
} from '../modules/device.ts';
import { warmthForDevice } from '../modules/warmth.ts';
import { config } from '../config.ts';
import { signToken } from '../core/security.ts';
import { pairingBaseUrl } from '../core/network.ts';

export function registerDeviceRoutes(router: Router, db: Db): void {
  router.post('/api/devices/pairing-code', 'user', ctx => createPairingCode(db, ctx.user!, ctx.body, pairingBaseUrl(ctx.req, config.publicUrl)),
    { max: 10, windowMs: 10 * 60_000, key: 'pairing-code' });
  router.get('/api/devices', 'user', ctx => listDevices(db, ctx.user!));
  router.delete('/api/devices/:id', 'user', ctx => revokeDevice(db, ctx.user!, ctx.params.id!));
  router.post('/api/devices/:id/push', 'user', ctx => pushPlan(db, ctx.user!, ctx.params.id!, ctx.body, ctx.ip));
  router.post('/api/devices/:id/request-photo', 'user', ctx => requestPhoto(db, ctx.user!, ctx.params.id!, ctx.body, ctx.ip),
    { max: 15, windowMs: 10 * 60_000, key: 'photo-request' });
  router.get('/api/snapshots', 'user', ctx => listSnapshots(db, ctx.user!, ctx.query.get('childId'), ctx.query.get('limit')));
  router.get('/api/snapshots/:id/image', 'user', ctx => {
    const { file, contentType } = snapshotFile(db, ctx.user!, ctx.params.id!);
    ctx.res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'private, no-store' });
    ctx.res.end(fs.readFileSync(file));
  });
  router.delete('/api/snapshots/:id', 'user', ctx => deleteSnapshot(db, ctx.user!, ctx.params.id!));
  router.delete('/api/children/:id/snapshots', 'user', ctx => purgeChildSnapshots(db, ctx.user!, ctx.params.id!));

  router.post('/api/device/verify-parent', 'device', ctx => verifyDeviceParent(db, ctx.device!, ctx.body), { max: 10, windowMs: 10 * 60_000, key: 'device-parent-verify' });
  router.post('/api/device/pair', 'public', ctx => pairDevice(db, ctx.body, ctx.ip),
    { max: 12, windowMs: 10 * 60_000, key: 'device-pair' });
  router.get('/api/device/warmth', 'device', () => warmthForDevice());
  router.get('/api/device/me', 'device', ctx => deviceProfile(db, ctx.device!, ctx.query.get('childId')));
  router.get('/api/device/inbox', 'device', ctx => deviceInbox(db, ctx.device!));
  router.post('/api/device/stream-ticket', 'device', ctx => ({ ticket: signToken({ sub: ctx.device!.id, typ: 'device-stream', did: ctx.device!.id, hid: ctx.device!.householdId }, 120), expiresIn: 120 }));
  router.get('/api/device/events', 'device', ctx => { openDeviceStream(ctx.device!, ctx.res); });
  router.post('/api/device/pushes/:id/ack', 'device', ctx => ackPush(db, ctx.device!, ctx.params.id!, ctx.body));
  router.get('/api/device/plans/:id', 'device', ctx => devicePlan(db, ctx.device!, ctx.params.id!));
  router.get('/api/device/lessons/:id', 'device', ctx => deviceLesson(db, ctx.device!, ctx.params.id!));
  router.post('/api/device/learning/start', 'device', ctx => startLearning(db, ctx.device!, ctx.body));
  router.post('/api/device/learning/:id/end', 'device', ctx => endLearning(db, ctx.device!, ctx.params.id!, ctx.body));
  router.post('/api/device/progress', 'device', ctx => completeLessonOnDevice(db, ctx.device!, ctx.body));
  router.post('/api/device/snapshots', 'device', ctx => saveSnapshot(db, ctx.device!, ctx.body),
    { max: 30, windowMs: 60_000, key: 'snapshot' });
}
