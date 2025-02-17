import { ApiObject, ApiObjectMetadataDefinition, Lazy, Names } from 'cdk8s';
import { Construct } from 'constructs';
import { Resource, ResourceProps } from './base';
import { Container, ContainerProps } from './container';
import * as k8s from './imports/k8s';
import { Ingress } from './ingress';
import { RestartPolicy, PodTemplate, IPodTemplate, PodTemplateProps, PodSecurityContext, HostAlias } from './pod';
import { ExposeServiceViaIngressOptions, Protocol, Service, ServiceType } from './service';
import { IServiceAccount } from './service-account';
import { Volume } from './volume';

/**
 * Properties for initialization of `Deployment`.
 */
export interface DeploymentProps extends ResourceProps, PodTemplateProps {

  /**
   * Number of desired pods.
   *
   * @default 1
   */
  readonly replicas?: number;

  /**
   * Automatically allocates a pod selector for this deployment.
   *
   * If this is set to `false` you must define your selector through
   * `deployment.podMetadata.addLabel()` and `deployment.selectByLabel()`.
   *
   * @default true
   */
  readonly defaultSelector?: boolean;

  /**
   * Specifies the strategy used to replace old Pods by new ones.
   *
   * @default - RollingUpdate with maxSurge and maxUnavailable set to 25%.
   */
  readonly strategy?: DeploymentStrategy;

}

/**
 * Options for exposing a deployment via a service.
 */
export interface ExposeDeploymentViaServiceOptions {

  /**
   * The port that the service should serve on.
   *
   * @default - Copied from the container of the deployment. If a port could not be determined, throws an error.
   */
  readonly port?: number;

  /**
   * The type of the exposed service.
   *
   * @default - ClusterIP.
   */
  readonly serviceType?: ServiceType;

  /**
   * The name of the service to expose.
   * This will be set on the Service.metadata and must be a DNS_LABEL
   *
   * @default undefined Uses the system generated name.
   */
  readonly name?: string;

  /**
   * The IP protocol for this port. Supports "TCP", "UDP", and "SCTP". Default is TCP.
   *
   * @default Protocol.TCP
   */
  readonly protocol?: Protocol;

  /**
   * The port number the service will redirect to.
   *
   * @default - The port of the first container in the deployment (ie. containers[0].port)
   */
  readonly targetPort?: number;
}

/**
 * Options for exposing a deployment via an ingress.
 */
export interface ExposeDeploymentViaIngressOptions extends ExposeDeploymentViaServiceOptions, ExposeServiceViaIngressOptions {}

/**
*
* A Deployment provides declarative updates for Pods and ReplicaSets.
*
* You describe a desired state in a Deployment, and the Deployment Controller changes the actual
* state to the desired state at a controlled rate. You can define Deployments to create new ReplicaSets, or to remove
* existing Deployments and adopt all their resources with new Deployments.
*
* > Note: Do not manage ReplicaSets owned by a Deployment. Consider opening an issue in the main Kubernetes repository if your use case is not covered below.
*
* Use Case
* ---------
*
* The following are typical use cases for Deployments:
*
* - Create a Deployment to rollout a ReplicaSet. The ReplicaSet creates Pods in the background.
*   Check the status of the rollout to see if it succeeds or not.
* - Declare the new state of the Pods by updating the PodTemplateSpec of the Deployment.
*   A new ReplicaSet is created and the Deployment manages moving the Pods from the old ReplicaSet to the new one at a controlled rate.
*   Each new ReplicaSet updates the revision of the Deployment.
* - Rollback to an earlier Deployment revision if the current state of the Deployment is not stable.
*   Each rollback updates the revision of the Deployment.
* - Scale up the Deployment to facilitate more load.
* - Pause the Deployment to apply multiple fixes to its PodTemplateSpec and then resume it to start a new rollout.
* - Use the status of the Deployment as an indicator that a rollout has stuck.
* - Clean up older ReplicaSets that you don't need anymore.
*
**/
export class Deployment extends Resource implements IPodTemplate {

  /**
   * Number of desired pods.
   */
  public readonly replicas: number;

  /**
   * The upgrade strategy of this deployment.
   */
  public readonly strategy: DeploymentStrategy;

  /**
   * @see base.Resource.apiObject
   */
  protected readonly apiObject: ApiObject;

  private readonly _podTemplate: PodTemplate;
  private readonly _labelSelector: Record<string, string>;

  constructor(scope: Construct, id: string, props: DeploymentProps = {}) {
    super(scope, id);

    this.apiObject = new k8s.KubeDeployment(this, 'Resource', {
      metadata: props.metadata,
      spec: Lazy.any({ produce: () => this._toKube() }),
    });

    this.replicas = props.replicas ?? 1;
    this.strategy = props.strategy ?? DeploymentStrategy.rollingUpdate();
    this._podTemplate = new PodTemplate(props);
    this._labelSelector = {};

    if (props.defaultSelector ?? true) {
      const selector = 'cdk8s.deployment';
      const matcher = Names.toLabelValue(this);
      this.podMetadata.addLabel(selector, matcher);
      this.selectByLabel(selector, matcher);
    }
  }

  public get podMetadata(): ApiObjectMetadataDefinition {
    return this._podTemplate.podMetadata;
  }

  /**
   * The labels this deployment will match against in order to select pods.
   *
   * Returns a a copy. Use `selectByLabel()` to add labels.
   */
  public get labelSelector(): Record<string, string> {
    return { ...this._labelSelector };
  }

  public get containers(): Container[] {
    return this._podTemplate.containers;
  }

  public get initContainers(): Container[] {
    return this._podTemplate.initContainers;
  }

  public get hostAliases(): HostAlias[] {
    return this._podTemplate.hostAliases;
  }

  public get volumes(): Volume[] {
    return this._podTemplate.volumes;
  }

  public get restartPolicy(): RestartPolicy | undefined {
    return this._podTemplate.restartPolicy;
  }

  public get serviceAccount(): IServiceAccount | undefined {
    return this._podTemplate.serviceAccount;
  }

  public get securityContext(): PodSecurityContext {
    return this._podTemplate.securityContext;
  }

  /**
   * Configure a label selector to this deployment.
   * Pods that have the label will be selected by deployments configured with this spec.
   *
   * @param key - The label key.
   * @param value - The label value.
   */
  public selectByLabel(key: string, value: string) {
    this._labelSelector[key] = value;
  }

  /**
   * Expose a deployment via a service.
   *
   * This is equivalent to running `kubectl expose deployment <deployment-name>`.
   *
   * @param options Options to determine details of the service and port exposed.
   */
  public exposeViaService(options: ExposeDeploymentViaServiceOptions = {}): Service {
    const service = new Service(this, 'Service', {
      metadata: options.name ? { name: options.name } : undefined,
      type: options.serviceType ?? ServiceType.CLUSTER_IP,
    });
    service.addDeployment(this, { protocol: options.protocol, targetPort: options.targetPort, port: options.port });
    return service;
  }

  /**
   * Expose a deployment via an ingress.
   *
   * This will first expose the deployment with a service, and then expose the service via an ingress.
   *
   * @param path The ingress path to register under.
   * @param options Additional options.
   */
  public exposeViaIngress(path: string, options: ExposeDeploymentViaIngressOptions = {}): Ingress {
    const service = this.exposeViaService(options);
    return service.exposeViaIngress(path, options);
  }

  public addContainer(container: ContainerProps): Container {
    return this._podTemplate.addContainer(container);
  }

  public addInitContainer(container: ContainerProps): Container {
    return this._podTemplate.addInitContainer(container);
  }

  public addHostAlias(hostAlias: HostAlias): void {
    return this._podTemplate.addHostAlias(hostAlias);
  }

  public addVolume(volume: Volume): void {
    return this._podTemplate.addVolume(volume);
  }


  /**
   * @internal
   */
  public _toKube(): k8s.DeploymentSpec {
    return {
      replicas: this.replicas,
      template: this._podTemplate._toPodTemplateSpec(),
      selector: {
        matchLabels: this._labelSelector,
      },
      strategy: this.strategy._toKube(),
    };
  }

}

/**
 * Options for `DeploymentStrategy.rollingUpdate`.
 */
export interface DeploymentStrategyRollingUpdateOptions {

  /**
   * The maximum number of pods that can be scheduled above the desired number of pods.
   * Value can be an absolute number (ex: 5) or a percentage of desired pods (ex: 10%).
   * Absolute number is calculated from percentage by rounding up.
   * This can not be 0 if `maxUnavailable` is 0.
   *
   * Example: when this is set to 30%, the new ReplicaSet can be scaled up immediately when the rolling update
   * starts, such that the total number of old and new pods do not exceed 130% of desired pods.
   * Once old pods have been killed, new ReplicaSet can be scaled up further, ensuring that
   * total number of pods running at any time during the update is at most 130% of desired pods.
   *
   * @default '25%'
   */
  readonly maxSurge?: PercentOrAbsolute;

  /**
   * The maximum number of pods that can be unavailable during the update.
   * Value can be an absolute number (ex: 5) or a percentage of desired pods (ex: 10%).
   * Absolute number is calculated from percentage by rounding down.
   * This can not be 0 if `maxSurge` is 0.
   *
   * Example: when this is set to 30%, the old ReplicaSet can be scaled down to 70% of desired
   * pods immediately when the rolling update starts. Once new pods are ready, old ReplicaSet can
   * be scaled down further, followed by scaling up the new ReplicaSet, ensuring that the total
   * number of pods available at all times during the update is at least 70% of desired pods.
   *
   * @default '25%'
   */
  readonly maxUnavailable?: PercentOrAbsolute;

}

/**
 * Union like class repsenting either a ration in
 * percents or an absolute number.
 */
export class PercentOrAbsolute {

  /**
   * Percent ratio.
   */
  public static percent(percent: number): PercentOrAbsolute {
    return new PercentOrAbsolute(`${percent}%`);
  }

  /**
   * Absolute number.
   */
  public static absolute(num: number): PercentOrAbsolute {
    return new PercentOrAbsolute(num);
  }

  private constructor(public readonly value: any) {}

  public isZero(): boolean {
    return this.value === PercentOrAbsolute.absolute(0).value || this.value === PercentOrAbsolute.percent(0).value;
  }

}

/**
 * Deployment strategies.
 */
export class DeploymentStrategy {

  /**
   * All existing Pods are killed before new ones are created.
   *
   * @see https://kubernetes.io/docs/concepts/workloads/controllers/deployment/#recreate-deployment
   */
  public static recreate(): DeploymentStrategy {
    return new DeploymentStrategy({
      type: 'Recreate',
    });
  }

  public static rollingUpdate(options: DeploymentStrategyRollingUpdateOptions = {}): DeploymentStrategy {

    const maxSurge = options.maxSurge ?? PercentOrAbsolute.percent(25);
    const maxUnavailable = options.maxSurge ?? PercentOrAbsolute.percent(25);

    if (maxSurge.isZero() && maxUnavailable.isZero()) {
      throw new Error('\'maxSurge\' and \'maxUnavailable\' cannot be both zero');
    }

    return new DeploymentStrategy({
      type: 'RollingUpdate',
      rollingUpdate: { maxSurge, maxUnavailable },
    });
  }

  private constructor(private readonly strategy: k8s.DeploymentStrategy) {}

  /**
   * @internal
   */
  public _toKube(): k8s.DeploymentStrategy {
    return this.strategy;
  }

}