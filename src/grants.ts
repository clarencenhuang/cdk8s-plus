import { IResource } from './base';
import { ResourceType } from './resource-type';

/**
 * Represents a resource or collection of resources that can be the
 * target of a rule in a Role or ClusterRole.
 */
export interface IGrantee {
  readonly apiGroups: Array<string>;
  readonly resources?: Array<string>;
  readonly resourceNames?: Array<string>;
}

/**
 * A class with utility methods for creating grantees.
 */
export class Grantee {
  /**
   * Returns a grantee for a collection of resources that can be used in a Role
   * or ClusterRole.
   */
  public static fromObjects(...objects: IResource[]): IGrantee {
    const apiGroups: string[] = normalizedArray(objects
      .map((obj) => obj.apiGroup)
      .map((apiGroup) => apiGroup === 'core' ? '' : apiGroup),
    );
    const resourceNames: string[] = normalizedArray(objects.map((obj) => obj.name));
    return {
      apiGroups,
      resourceNames,
    };
  }

  /**
   * Combine multiple resource kinds into a single grantee that can be used in a
   * Role or ClusterRole.
   */
  public static fromKinds(...types: ResourceType[]): IGrantee {
    const apiGroups = normalizedArray(types
      .map(type => type.apiGroups)
      .flat(),
    );
    const resources = normalizedArray(types
      .map(type => type.resources)
      .filter((x): x is string[] => Boolean(x))
      .flat(),
    );
    return { apiGroups, resources };
  }
}

function normalizedArray<T>(xs: T[]): T[] {
  return Array.from(new Set(xs)).sort();
}