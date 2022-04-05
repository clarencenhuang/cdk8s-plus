import { Testing } from 'cdk8s';
import * as kplus from '../src';

test('can create a RoleBinding from a Role', () => {
  // GIVEN
  const chart = Testing.chart();

  const role = new kplus.Role(chart, 'pod-reader');
  role.allowRead(kplus.ApiResource.PODS);

  // WHEN
  const user = new kplus.User({ name: 'alice@example.com' });
  const group = new kplus.Group({ name: 'frontend-admins' });
  role.bind(user, group);

  // THEN
  const manifest = Testing.synth(chart);
  expect(manifest[1].kind).toEqual('RoleBinding');
  expect(manifest[1].roleRef.kind).toEqual('Role');
  expect(manifest[1]).toMatchInlineSnapshot(`
Object {
  "apiVersion": "rbac.authorization.k8s.io/v1",
  "kind": "RoleBinding",
  "metadata": Object {
    "name": "test-pod-reader-rolebinding-c893c967",
  },
  "roleRef": Object {
    "apiGroup": "rbac.authorization.k8s.io",
    "kind": "Role",
    "name": "test-pod-reader-c8ec1643",
  },
  "subjects": Array [
    Object {
      "apiGroup": "rbac.authorization.k8s.io",
      "kind": "User",
      "name": "alice@example.com",
    },
    Object {
      "apiGroup": "rbac.authorization.k8s.io",
      "kind": "Group",
      "name": "frontend-admins",
    },
  ],
}
`);
});

test('can create a RoleBinding from a ClusterRole', () => {
  // GIVEN
  const chart = Testing.chart();

  const role = new kplus.ClusterRole(chart, 'pod-reader');
  role.allowRead(kplus.ApiResource.PODS);

  // WHEN
  const user = new kplus.User({
    name: 'alice@example.com',
  });
  role.bindInNamespace('development', user);

  // THEN
  const manifest = Testing.synth(chart);
  expect(manifest[1].kind).toEqual('RoleBinding');
  expect(manifest[1].metadata.namespace).toEqual('development');
  expect(manifest[1].roleRef.kind).toEqual('ClusterRole');
  expect(manifest[1]).toMatchInlineSnapshot(`
Object {
  "apiVersion": "rbac.authorization.k8s.io/v1",
  "kind": "RoleBinding",
  "metadata": Object {
    "name": "test-pod-reader-rolebinding-development-c87e6459",
    "namespace": "development",
  },
  "roleRef": Object {
    "apiGroup": "rbac.authorization.k8s.io",
    "kind": "ClusterRole",
    "name": "test-pod-reader-c8ec1643",
  },
  "subjects": Array [
    Object {
      "apiGroup": "rbac.authorization.k8s.io",
      "kind": "User",
      "name": "alice@example.com",
    },
  ],
}
`);
});

test('can call bindInNamespace multiple times', () => {
  // GIVEN
  const chart = Testing.chart();

  const role = new kplus.ClusterRole(chart, 'pod-reader');
  role.allowRead(kplus.ApiResource.PODS);

  // WHEN
  const user1 = new kplus.User({
    name: 'alice@example.com',
  });
  const user2 = new kplus.User({
    name: 'bob@example.com',
  });
  role.bindInNamespace('staging', user1);
  role.bindInNamespace('development', user2);

  // THEN
  const manifest = Testing.synth(chart);
  expect(manifest[1].kind).toEqual('RoleBinding');
  expect(manifest[1].metadata.namespace).toEqual('staging');
  expect(manifest[1].roleRef.kind).toEqual('ClusterRole');
  expect(manifest[1].subjects[0].name).toEqual('alice@example.com');
  expect(manifest[2].kind).toEqual('RoleBinding');
  expect(manifest[2].metadata.namespace).toEqual('development');
  expect(manifest[2].roleRef.kind).toEqual('ClusterRole');
  expect(manifest[2].subjects[0].name).toEqual('bob@example.com');
});

test('can create a ClusterRoleBinding from a ClusterRole', () => {
  // GIVEN
  const chart = Testing.chart();

  const role = new kplus.ClusterRole(chart, 'pod-reader');
  role.allowRead(kplus.ApiResource.PODS);

  // WHEN
  const user = new kplus.User({
    name: 'alice@example.com',
  });
  role.bind(user);

  // THEN
  const manifest = Testing.synth(chart);
  expect(manifest[1].kind).toEqual('ClusterRoleBinding');
  expect(manifest[1].roleRef.kind).toEqual('ClusterRole');
  expect(manifest[1]).toMatchInlineSnapshot(`
Object {
  "apiVersion": "rbac.authorization.k8s.io/v1",
  "kind": "ClusterRoleBinding",
  "metadata": Object {
    "name": "test-pod-reader-clusterrolebinding-c8d868b9",
  },
  "roleRef": Object {
    "apiGroup": "rbac.authorization.k8s.io",
    "kind": "ClusterRole",
    "name": "test-pod-reader-c8ec1643",
  },
  "subjects": Array [
    Object {
      "apiGroup": "rbac.authorization.k8s.io",
      "kind": "User",
      "name": "alice@example.com",
    },
  ],
}
`);
});

test('can bind a ServiceAccount to a role', () => {
  // GIVEN
  const chart = Testing.chart();

  const role = new kplus.Role(chart, 'pod-reader');
  role.allowRead(kplus.ApiResource.PODS);

  // WHEN
  const serviceAccount = new kplus.ServiceAccount(chart, 'my-service-account');
  role.bind(serviceAccount);

  // THEN
  const manifest = Testing.synth(chart);
  expect(manifest[1].subjects).toEqual([
    {
      apiGroup: '',
      kind: 'ServiceAccount',
      name: 'test-my-service-account-c84bb46b',
    },
  ]);
});

test('can add subjects to a RoleBinding after creating it', () => {
  // GIVEN
  const chart = Testing.chart();

  const role = new kplus.Role(chart, 'pod-reader');
  role.allowRead(kplus.ApiResource.PODS);

  // WHEN
  const user = new kplus.User({ name: 'alice@example.com' });
  const group = new kplus.Group({ name: 'frontend-admins' });
  const binding = role.bind();
  binding.addSubjects(user, group);

  // THEN
  const manifest = Testing.synth(chart);
  expect(manifest[1].subjects).toEqual([
    {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'User',
      name: 'alice@example.com',
    },
    {
      apiGroup: 'rbac.authorization.k8s.io',
      kind: 'Group',
      name: 'frontend-admins',
    },
  ]);
});