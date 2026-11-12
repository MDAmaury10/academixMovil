import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pendingEvents, slackPayload } from './project-status.mjs';

test('recupera ambos movimientos de una tarjeta y excluye otros tableros', () => {
  const events = [
    { id: 'b', project: { id: 'target' }, createdAt: '2026-11-12T03:06:00Z', previousStatus: 'Review', status: 'Backlog' },
    { id: 'a', project: { id: 'target' }, createdAt: '2026-11-12T03:05:00Z', previousStatus: 'Backlog', status: 'Review' },
    { id: 'c', project: { id: 'other' }, createdAt: '2026-11-12T03:07:00Z', previousStatus: 'Review', status: 'Done' }
  ];
  assert.deepEqual(pendingEvents(events, 'target', new Set()).map(event => event.id), ['a', 'b']);
  assert.deepEqual(pendingEvents(events, 'target', new Set(['a'])).map(event => event.id), ['b']);
});

test('usa texto plano para que una tarjeta no pueda crear menciones', () => {
  const payload = slackPayload(
    { title: '<!channel> Revisión', url: 'https://github.com/a/b/issues/1' },
    { previousStatus: 'Backlog', status: 'In Progress', actor: { login: 'marco' } }
  );
  assert.equal(payload.blocks[0].text.type, 'plain_text');
  assert.match(payload.blocks[0].text.text, /Backlog → In Progress/);
  assert.equal(payload.blocks[1].elements[0].url, 'https://github.com/a/b/issues/1');
});
