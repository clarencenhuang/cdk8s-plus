import * as fs from 'fs';
import * as path from 'path';
import { Project, SourceCode } from 'projen';
import { snakeCase } from 'snake-case';

/**
 * Generate a source file for the `Kind` module, based on information about API
 * resources generated by running `kubectl api-resources -o wide`.
 *
 * We do this because `kubectl api-resources` doesn't support JSON output
 * formatting, and at the time of writing, parsing this command output seemed
 * simpler than extracting information from the OpenAPI schema.
 */
export function generateKinds(project: Project, sourcePath: string, outputPath: string) {
  const resourceTypes = parseApiResources(sourcePath);
  const ts = new SourceCode(project, outputPath);
  if (ts.marker) {
    ts.line(`// ${ts.marker}`);
  }
  ts.line('import type { IGrantee } from \'./grants\';');
  ts.line();
  ts.open('export interface KindOptions {');
  ts.line('readonly apiGroups: Array<string>;');
  ts.line('readonly resources: Array<string>;');
  ts.close('}');
  ts.line();
  ts.line('/**');
  ts.line(' * Represents information about an API resource type.');
  ts.line(' */');
  ts.open('export class Kind implements IGrantee {');

  for (const resource of resourceTypes) {
    const typeName = normalizeTypeName(resource.kind);
    const memberName = snakeCase(typeName.replace(/[^a-z0-9]/gi, '_')).split('_').filter(x => x).join('_').toUpperCase();
    const apiGroups = resource.apiVersions.map(parseApiGroup);

    ts.line('/**');
    ts.line(` * API resource information for ${resource.kind}.`);
    ts.line(' */');
    ts.open(`public static readonly ${memberName} = new Kind({`);
    ts.line(`apiGroups: [${apiGroups.map(group => `'${group}'`).join(', ')}],`);
    ts.line(`resources: ['${resource.name}'],`);
    ts.close('});');
    ts.line();
  }

  ts.open('public static custom(options: KindOptions): Kind {');
  ts.line('return new Kind(options);');
  ts.close('};');
  ts.line();
  ts.line('private readonly _apiGroups: Array<string>;');
  ts.line('private readonly _resources: Array<string>;');
  ts.line();
  ts.open('private constructor(options: KindOptions) {');
  ts.line('this._apiGroups = options.apiGroups;');
  ts.line('this._resources = options.resources;');
  ts.close('}');
  ts.line();
  ts.open('public get apiGroups(): Array<string> {');
  ts.line('return [...this._apiGroups];');
  ts.close('}');
  ts.line();
  ts.open('public get resources(): Array<string> | undefined {');
  ts.line('return [...this._resources];');
  ts.close('}');
  ts.close('}');
  ts.line();
}

/**
 * Extract structured API resource information from the textual output of the
 * `kubectl api-resources -o wide` command.
 */
function parseApiResources(filename: string): Array<ApiResourceEntry> {
  const fileContents = fs.readFileSync(path.join(filename)).toString();
  const lines = fileContents.split('\n');
  const header = lines[0];
  const dataLines = lines.slice(1);
  const columns = calculateColumnMetadata(header);

  const apiResources = new Array<ApiResourceEntry>();

  for (const line of dataLines) {
    const entry: any = {};

    for (const column of columns) {
      const value = line.slice(column.start, column.end).trim();
      entry[column.title.toLowerCase()] = value;
    }

    const massaged = sanitizeData(entry);
    apiResources.push(massaged);
  }

  combineResources(apiResources);

  return apiResources;
}

/**
 * Sanitize data that has been parsed from `kubectl api-resources -o wide`
 * from string types into JavaScript values like booleans and arrays.
 */
function sanitizeData(entry: any): ApiResourceEntry {
  let shortnames = entry.shortnames.split(',');
  shortnames = shortnames[0].length === 0 ? [] : shortnames;

  return {
    name: entry.name,
    shortnames,
    apiVersions: [entry.apiversion],
    namespaced: Boolean(entry.namespaced),
    kind: entry.kind,
    verbs: entry.verbs.slice(1, -1).split(' '),
  };
}

/**
 * Sometimes resources have multiple API versions (e.g. events is listed under
 * "v1" and "events.k8s.io/v1"), so we combine them together.
 */
function combineResources(resources: ApiResourceEntry[]) {
  let i = 0;
  while (i < resources.length) {
    let didCombine = false;
    for (let j = i + 1; j < resources.length; j++) {
      if (resources[i].kind === resources[j].kind
        && resources[i].name === resources[j].name
        && resources[i].namespaced === resources[j].namespaced
      ) {
        const combined: ApiResourceEntry = {
          kind: resources[i].kind,
          name: resources[i].name,
          apiVersions: Array.from(new Set(
            [...resources[i].apiVersions, ...resources[j].apiVersions],
          )),
          namespaced: resources[i].namespaced,
          shortnames: Array.from(new Set(
            [...resources[i].shortnames, ...resources[j].shortnames],
          )),
          verbs: Array.from(new Set(
            [...resources[i].verbs, ...resources[j].verbs],
          )),
        };
        resources[i] = combined;
        resources.splice(j, 1);
        didCombine = true;
        break;
      }
    }

    if (!didCombine) {
      i++;
    }
  }
}

interface ApiResourceEntry {
  readonly name: string;
  readonly shortnames: string[];
  readonly apiVersions: string[];
  readonly namespaced: boolean;
  readonly kind: string;
  readonly verbs: string[];
}

interface Column {
  readonly title: string;
  readonly start: number;
  readonly end?: number; // last column does not have an end index
}

/**
 * Given a string of this form:
 *
 * "NAME      SHORTNAMES  APIVERSION"
 *  0         10          22        31
 *
 * we return an array like:
 *
 * [{ title: "NAME", start: 0, end: 10 },
 *  { title: "SHORTNAMES", start: 10, end: 22 },
 *  { title: "APIVERSION", start: 22, end: 31 }]
 */
function calculateColumnMetadata(header: string): Array<Column> {
  const headerRegex = /([A-Z]+)(\s+)([A-Z]+)(\s+)([A-Z]+)(\s+)([A-Z]+)(\s+)([A-Z]+)(\s+)([A-Z]+)/;
  const matches = headerRegex.exec(header)!;

  const columns = new Array<Column>();
  let currIndex = 0;

  for (let matchIdx = 1; matchIdx < matches.length - 1; matchIdx += 2) {
    const start = currIndex;
    const title = matches[matchIdx];
    currIndex += matches[matchIdx].length;
    currIndex += matches[matchIdx + 1].length;
    const end = currIndex;

    columns.push({ title, start, end });
  }

  // add last column as special case
  columns.push({ title: matches[matches.length - 1], start: currIndex });

  return columns;
}

/**
 * Convert all-caps acronyms (e.g. "VPC", "FooBARZooFIGoo") to pascal case
 * (e.g. "Vpc", "FooBarZooFiGoo").
 */
function normalizeTypeName(typeName: string) {
  // start with the full string and then use the regex to match all-caps sequences.
  const re = /([A-Z]+)(?:[^a-z]|$)/g;
  let result = typeName;
  let m;
  do {
    m = re.exec(typeName);
    if (m) {
      const before = result.slice(0, m.index); // all the text before the sequence
      const cap = m[1]; // group #1 matches the all-caps sequence we are after
      const pascal = cap[0] + cap.slice(1).toLowerCase(); // convert to pascal case by lowercasing all but the first char
      const after = result.slice(m.index + pascal.length); // all the text after the sequence
      result = before + pascal + after; // concat
    }
  } while (m);

  result = result.replace(/^./, result[0].toUpperCase()); // ensure first letter is capitalized
  return result;
}

/**
 * Parses the apiGroup from an apiVersion.
 * @example "admissionregistration.k8s.io/v1" => "admissionregistration.k8s.io"
 */
function parseApiGroup(apiVersion: string) {
  const v = apiVersion.split('/');

  // no group means it's in the core group
  // https://kubernetes.io/docs/reference/using-api/api-overview/#api-groups
  if (v.length === 1) {
    return '';
  }

  if (v.length === 2) {
    return v[0];
  }

  throw new Error(`invalid apiVersion ${apiVersion}, expecting GROUP/VERSION. See https://kubernetes.io/docs/reference/using-api/api-overview/#api-groups`);
}
