import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { request } from 'node:http';
import { createLocalServer } from '../../src/web/server.js';
import type { WebTable } from '../../src/web/protocol.js';

describe('local browser table', () => {
  const server = createLocalServer();
  let origin: string;
  let cookie = '';
  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing listener');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    if (!server.listening) return;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  async function post(path: string, body: unknown, extra: Record<string, string> = {}) {
    const response = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie, origin, ...extra },
      body: JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0]!;
    return response;
  }
  it('rejects invalid counts and foreign origins without creating a game', async () => {
    expect((await post('/api/table', { players: 7 })).status).toBe(400);
    expect((await post('/api/table', { players: 2, mode: 'unknown' })).status).toBe(400);
    expect((await post('/api/table', { players: 4 }, { origin: 'https://unrelated.example' })).status).toBe(403);
    expect((await fetch(`${origin}/api/bootstrap`)).status).toBe(200);
    expect((await fetch(`${origin}/src/core/state.ts`)).status).toBe(404);
  });
  it('keeps peek private, restores it once, rejects duplicate/spent requests and clears it at settlement', async () => {
    let { table } = await (await post('/api/table', { players: 2, mode: 'ability-lab' })).json() as { table: WebTable };
    expect(table.mode).toBe('ability-lab');
    if (table.packet.kind !== 'decision') throw new Error('Expected decision');
    const before = table;
    const peek = { tableId: table.id, command: { type: 'useAbility', ability: 'peek', targetSeatIndex: 1,
      decisionKey: table.packet.decisionKey, expectedPacketIndex: table.packet.packetIndex } };
    const peeked = await post('/api/action', peek);
    expect(peeked.status).toBe(200);
    table = (await peeked.json() as { table: WebTable }).table;
    if (table.packet.kind !== 'decision' || !table.packet.abilities) throw new Error('Expected private intel');
    expect(table.packet.abilities.charges.peek).toBe(0);
    expect(table.packet.abilities.knowledge).toHaveLength(1);
    expect(table.view).toEqual(before.view);
    expect(table.view.seats[1]!.cards).toBeNull();
    expect((await post('/api/action', peek)).status).toBe(409);
    const spent = await post('/api/action', { ...peek, command: { ...peek.command, expectedPacketIndex: table.packet.packetIndex } });
    expect(await spent.json()).toMatchObject({ rejection: 'ability-spent' });
    const restored = await fetch(`${origin}/api/bootstrap`, { headers: { cookie } });
    expect((await restored.json() as { table: WebTable }).table).toEqual(table);
    expect((await (await fetch(`${origin}/api/bootstrap`)).json() as { table: unknown }).table).toBeNull();
    const finish = await post('/api/action', { tableId: table.id, command: { type: 'act', intent: { type: 'fold' },
      decisionKey: table.packet.decisionKey, expectedPacketIndex: table.packet.packetIndex } });
    table = (await finish.json() as { table: WebTable }).table;
    expect(table.packet.kind).toBe('hand-result');
    expect(table.packet.privateEventsSinceLastPacket).toEqual([]);
    expect('abilities' in table.packet).toBe(false);
    const next = await post('/api/continue', { tableId: table.id, expectedPacketIndex: table.packet.packetIndex });
    table = (await next.json() as { table: WebTable }).table;
    if (table.packet.kind !== 'decision' || !table.packet.abilities) throw new Error('Expected next decision');
    expect(table.packet.abilities.knowledge).toEqual([]);
    expect(table.packet.abilities.charges.peek).toBe(0);
  });
  it.each(['read', 'swap'] as const)('delivers %s through HTTP, restores it on refresh, and rejects same-decision reuse', async (ability) => {
    let { table } = await (await post('/api/table', { players: 2, mode: 'ability-lab' })).json() as { table: WebTable };
    if (table.packet.kind !== 'decision') throw new Error('Expected decision');
    const originalCards = table.view.holeCards;
    const command = { type: 'useAbility', decisionKey: table.packet.decisionKey,
      expectedPacketIndex: table.packet.packetIndex, ability,
      ...(ability === 'read' ? { targetSeatIndex: 1 } : { holeCardIndex: 0 }),
    };
    const response = await post('/api/action', { tableId: table.id, command });
    expect(response.status).toBe(200);
    table = (await response.json() as { table: WebTable }).table;
    if (table.packet.kind !== 'decision' || !table.packet.abilities) throw new Error('Expected abilities');
    expect(table.packet.abilities.charges[ability]).toBe(0);
    expect(table.packet.abilities.usedThisDecision).toBe(true);
    expect(table.view.seats[1]!.cards).toBeNull();
    const receipt = table.packet.abilities.knowledge[0]!;
    expect(receipt.type).toBe(ability);
    if (receipt.type === 'read') {
      expect(Object.keys(receipt).sort()).toEqual(['band', 'handNumber', 'street', 'targetSeatIndex', 'type']);
      expect(table.view.holeCards).toEqual(originalCards);
    } else if (receipt.type === 'swap') {
      expect(table.view.holeCards).toEqual([receipt.newCard, originalCards![1]]);
      expect(receipt.oldCard).toEqual(originalCards![0]);
    }
    const locked = await post('/api/action', { tableId: table.id, command: {
      type: 'useAbility', ability: 'peek', targetSeatIndex: 1, decisionKey: table.packet.decisionKey,
      expectedPacketIndex: table.packet.packetIndex,
    } });
    expect(locked.status).toBe(409);
    expect(await locked.json()).toMatchObject({ rejection: 'ability-already-used-this-decision', table });
    expect((await post('/api/action', { tableId: table.id, command })).status).toBe(409);
    const restored = await fetch(origin + '/api/bootstrap', { headers: { cookie } });
    expect((await restored.json() as { table: WebTable }).table).toEqual(table);
  });

  it('does not permit a forged mode on action to enable peek in a classic table', async () => {
    const { table } = await (await post('/api/table', { players: 2 })).json() as { table: WebTable };
    expect(table.mode).toBe('classic');
    if (table.packet.kind !== 'decision') throw new Error('Expected decision');
    const response = await post('/api/action', { tableId: table.id, mode: 'ability-lab', command: {
      type: 'useAbility', ability: 'peek', targetSeatIndex: 1,
      decisionKey: table.packet.decisionKey, expectedPacketIndex: table.packet.packetIndex,
    } });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ rejection: 'wrong-mode', table });
  });
  it.each([2, 6])('creates a %i-seat table and restores only its public view', async (players) => {
    const response = await post('/api/table', { players });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toMatch(/^holdem_session_\d+=/);
    const { table } = await response.json() as { table: WebTable };
    expect(table.roster).toHaveLength(players);
    expect(table.view.seats).toHaveLength(players);
    expect(table.view.holeCards).toHaveLength(2);
    for (const seat of table.view.seats.filter((seat) => seat.seatIndex !== 0)) {
      expect(seat.cards).toBeNull();
    }
    const restored = await fetch(`${origin}/api/bootstrap`, { headers: { cookie } });
    expect((await restored.json() as { table: WebTable }).table).toEqual(table);
    expect((await (await fetch(`${origin}/api/bootstrap`)).json() as { table: unknown }).table).toBeNull();
    const serialized = JSON.stringify(table);
    expect(serialized).not.toMatch(/"(?:runSeed|seedHash|deck|authority|privateTrace)"/);
  });
  it('accepts a legal action once, settles a hand, then requires explicit continuation', async () => {
    let { table } = await (await post('/api/table', { players: 2 })).json() as { table: WebTable };
    expect(table.packet.kind).toBe('decision');
    if (table.packet.kind !== 'decision') throw new Error('Expected decision');
    const first = {
      tableId: table.id,
      command: { type: 'act', decisionKey: table.packet.decisionKey,
        expectedPacketIndex: table.packet.packetIndex, intent: { type: 'fold' } },
    };
    const accepted = await post('/api/action', first);
    expect(accepted.status).toBe(200);
    table = (await accepted.json() as { table: WebTable }).table;
    const duplicate = await post('/api/action', first);
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json() as { table: WebTable }).table.packet.packetIndex).toBe(table.packet.packetIndex);
    expect(table.packet.kind).toBe('hand-result');
    if (table.packet.kind !== 'hand-result') throw new Error('Expected hand result');
    expect(table.packet.handResult.seats.reduce((total, seat) => total + seat.finalStack, 0)).toBe(200);
    const continued = await post('/api/continue', { tableId: table.id, expectedPacketIndex: table.packet.packetIndex });
    expect(continued.status).toBe(200);
    const next = (await continued.json() as { table: WebTable }).table;
    expect(next.packet.packetIndex).toBe(table.packet.packetIndex + 1);
    expect(next.view.handNumber).toBe(2);
    const oldId = table.id;
    await post('/api/table', { players: 4 });
    expect((await post('/api/continue', { tableId: oldId, expectedPacketIndex: next.packet.packetIndex })).status).toBe(409);
  });
  it('plays a real six-seat hand through HTTP and reconciles the rendered public table', async () => {
    let { table } = await (await post('/api/table', { players: 6 })).json() as { table: WebTable };
    for (let attempt = 0; attempt < 60 && table.packet.kind === 'decision'; attempt++) {
      const packet = table.packet;
      const type = packet.observation.legalActions.check ? 'check' : 'call';
      const response = await post('/api/action', { tableId: table.id,
        command: { type: 'act', decisionKey: packet.decisionKey, expectedPacketIndex: packet.packetIndex, intent: { type } } });
      expect(response.status).toBe(200);
      table = (await response.json() as { table: WebTable }).table;
    }
    expect(table.packet.kind).toBe('hand-result');
    if (table.packet.kind !== 'hand-result') throw new Error('Hand did not finish');
    const result = table.packet.handResult;
    expect(result.seats.reduce((sum, seat) => sum + seat.finalStack, 0)).toBe(600);
    expect(result.seats.reduce((sum, seat) => sum + seat.net, 0)).toBe(0);
    expect(table.view.potTotal).toBe(0);
    for (const seat of result.seats) {
      expect(table.view.seats.find((item) => item.seatIndex === seat.seatIndex)?.stack).toBe(seat.finalStack);
      if (seat.bestFive) expect(seat.bestFive).toHaveLength(5);
    }
    const restored = await fetch(`${origin}/api/bootstrap`, { headers: { cookie } });
    expect((await restored.json() as { table: WebTable }).table).toEqual(table);
  });
  it('does not revive a replaced table when an old request body arrives late', async () => {
    const { table: old } = await (await post('/api/table', { players: 2 })).json() as { table: WebTable };
    if (old.packet.kind !== 'decision') throw new Error('Expected decision');
    const observedHeaders = new Promise<void>((resolve) => server.once('request', () => resolve()));
    let status = 0;
    let pending: ReturnType<typeof request> | undefined;
    const responseBody = new Promise<string>((resolve, reject) => {
      pending = request(`${origin}/api/action`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' } }, (response) => {
        status = response.statusCode ?? 0;
        let body = '';
        response.on('data', (chunk) => { body += String(chunk); });
        response.on('end', () => resolve(body));
      });
      pending.on('error', reject);
    });
    // Headers reach the server first; the body deliberately arrives after replacement.
    function bodyForOldTable() {
      return JSON.stringify({ tableId: old.id, command: { type: 'act',
        decisionKey: old.packet.kind === 'decision' ? old.packet.decisionKey : '',
        expectedPacketIndex: old.packet.packetIndex, intent: { type: 'fold' } } });
    }
    pending!.flushHeaders();
    await observedHeaders;
    const { table: current } = await (await post('/api/table', { players: 4 })).json() as { table: WebTable };
    pending!.end(bodyForOldTable());
    const result = JSON.parse(await responseBody) as { table: WebTable };
    expect(status).toBe(409);
    expect(result.table.id).toBe(current.id);
  });
});
