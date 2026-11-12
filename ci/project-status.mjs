import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const owner = 'MDAmaury10';
const projectNumber = 4;
const projectUrl = 'https://github.com/users/MDAmaury10/projects/4';
const stateDirectory = '.project-notification-state';
const stateFile = `${stateDirectory}/state.json`;
const overlapMs = 2 * 60 * 60 * 1000;

const itemsQuery = `query($owner: String!, $number: Int!, $cursor: String) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      items(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isArchived
          fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          content {
            __typename
            ... on Issue { id title url }
            ... on PullRequest { id title url }
            ... on DraftIssue { title }
          }
        }
      }
    }
  }
}`;

const timelineFields = `
  timelineItems(first: 100, after: $cursor, since: $since,
    itemTypes: [PROJECT_V2_ITEM_STATUS_CHANGED_EVENT]) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on ProjectV2ItemStatusChangedEvent {
        id createdAt previousStatus status actor { login } project { id }
      }
    }
  }
`;

const timelineQuery = `query($id: ID!, $cursor: String, $since: DateTime!) {
  node(id: $id) {
    ... on Issue { ${timelineFields} }
    ... on PullRequest { ${timelineFields} }
  }
}`;

export function pendingEvents(events, projectId, delivered) {
  return events
    .filter(event => event?.id && event.project?.id === projectId && !delivered.has(event.id))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export function slackPayload(card, event) {
  const actor = event.actor?.login ? ` · @${event.actor.login}` : '';
  const movement = `${event.previousStatus || 'Sin estado'} → ${event.status || 'Sin estado'}${actor}`;
  const title = card.title.slice(0, 400);
  return {
    text: 'AcademixMovil: cambio de estado en GitHub Projects',
    blocks: [
      { type: 'section', text: { type: 'plain_text', text: `AcademixMovil · ${title}\n${movement}` } },
      { type: 'actions', elements: [{
        type: 'button', text: { type: 'plain_text', text: 'Abrir en GitHub' }, url: card.url ?? projectUrl
      }] }
    ]
  };
}

async function graphql(query, variables, token) {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000)
  });
  if (!response.ok) throw new Error(`GitHub GraphQL respondió HTTP ${response.status}.`);
  const result = await response.json();
  if (result.errors?.length) {
    throw new Error(result.errors.map(({ message }) => message).join('; '));
  }
  return result.data;
}

async function* pages(getPage) {
  let cursor = null;
  do {
    const page = await getPage(cursor);
    if (!page) throw new Error('GitHub no devolvió la página solicitada.');
    yield* page.nodes;
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
}

async function saveState(state) {
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(`${stateFile}.tmp`, JSON.stringify(state));
  await rename(`${stateFile}.tmp`, stateFile);
}

async function sendSlack(webhook, card, event) {
  let response;
  try {
    response = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(slackPayload(card, event)),
      redirect: 'error',
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new Error('No fue posible conectar con Slack.');
  }
  if (!response.ok) throw new Error(`Slack respondió HTTP ${response.status}.`);
}

async function main() {
  const token = process.env.PROJECTS_READ_TOKEN;
  const webhook = process.env.SLACK_PROJECT_WEBHOOK;
  if (!token || !webhook) throw new Error('Configura PROJECTS_READ_TOKEN y SLACK_PROJECT_WEBHOOK.');
  if (!/^https:\/\/hooks\.slack(?:-gov)?\.com\/services\//.test(webhook)) {
    throw new Error('SLACK_PROJECT_WEBHOOK debe ser un Incoming Webhook de Slack.');
  }

  const now = new Date().toISOString();
  let state;
  try {
    state = JSON.parse(await readFile(stateFile, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let projectId;
  const items = pages(async cursor => {
    const data = await graphql(itemsQuery, { owner, number: projectNumber, cursor }, token);
    const project = data.user?.projectV2;
    if (!project) throw new Error('El token no tiene acceso al tablero AcademixMovil.');
    projectId = project.id;
    return project.items;
  });
  const drafts = {};
  const changes = [];
  const since = state && new Date(Math.max(Date.parse(state.started), Date.parse(state.watermark) - overlapMs)).toISOString();

  for await (const item of items) {
    const card = item?.content;
    if (item?.isArchived || !card?.title) continue;
    if (card.__typename === 'DraftIssue') {
      const status = item.fieldValueByName?.name ?? '';
      drafts[item.id] = status;
      if (state && Object.hasOwn(state.drafts, item.id) && state.drafts[item.id] !== status) {
        changes.push({ card, draftId: item.id, event: { createdAt: now, previousStatus: state.drafts[item.id], status } });
      }
      continue;
    }
    if (!since) continue;
    const events = pages(async cursor => {
      const data = await graphql(timelineQuery, { id: card.id, cursor, since }, token);
      return data.node?.timelineItems;
    });
    const delivered = new Set(Object.keys(state.delivered));
    for await (const event of events) {
      if (pendingEvents([event], projectId, delivered).length && Date.parse(event.createdAt) > Date.parse(state.started)) {
        changes.push({ card, event });
      }
    }
  }

  if (!state) {
    await saveState({ started: now, watermark: now, delivered: {}, drafts });
    console.log('Punto de partida registrado. No se reenvió el historial anterior.');
    return;
  }

  changes.sort((a, b) => Date.parse(a.event.createdAt) - Date.parse(b.event.createdAt));
  for (const { card, event, draftId } of changes) {
    if (event.id && Object.hasOwn(state.delivered, event.id)) continue;
    await sendSlack(webhook, card, event);
    if (draftId) state.drafts[draftId] = event.status;
    if (event.id) state.delivered[event.id] = event.createdAt;
    await saveState(state);
  }

  state.watermark = now;
  state.drafts = drafts;
  for (const [id, date] of Object.entries(state.delivered)) {
    if (Date.parse(date) < Date.parse(now) - overlapMs) delete state.delivered[id];
  }
  await saveState(state);
  console.log(`Cambios de estado enviados a Slack: ${changes.length}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
