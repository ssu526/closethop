import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Stack,
  StackProps
} from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export interface ClosetHopDevStackProps extends StackProps {
  environmentName: string;
  callbackUrl: string;
  logoutUrl: string;
  googleSecretName: string;
  geminiSecretName: string;
  alertEmail?: string;
}

export class ClosetHopDevStack extends Stack {
  constructor(scope: Construct, id: string, props: ClosetHopDevStackProps) {
    super(scope, id, props);

    const prefix = `closethop-${props.environmentName}`;
    const isProduction = props.environmentName === "prod";
    const frontendOrigin = new URL(props.callbackUrl).origin;
    const dataRemovalPolicy = isProduction ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
    const alertTopic = props.alertEmail
      ? new sns.Topic(this, "AlertTopic", {
        topicName: `${prefix}-alerts`,
        displayName: `ClosetHop ${props.environmentName} alerts`
      })
      : undefined;
    if (alertTopic) {
      alertTopic.addSubscription(
        new snsSubscriptions.EmailSubscription(props.alertEmail!)
      );
    }
    const addAlarmAction = (alarm: cloudwatch.Alarm) => {
      if (alertTopic) alarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));
    };

    const imageBucket = new s3.Bucket(this, "ImageBucket", {
      bucketName: `${prefix}-images-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: isProduction,
      removalPolicy: dataRemovalPolicy,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.GET,
            s3.HttpMethods.HEAD,
            s3.HttpMethods.PUT
          ],
          allowedOrigins: [
            frontendOrigin,
            "http://localhost:3000",
            "http://localhost:5173"
          ],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 300
        }
      ],
      lifecycleRules: [
        {
          id: "AbortIncompleteUserUploads",
          prefix: "users/",
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        }
      ]
    });

    const backupBucket = new s3.Bucket(this, "DatabaseBackupBucket", {
      bucketName: `${prefix}-postgres-backups-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: isProduction,
      removalPolicy: dataRemovalPolicy,
      lifecycleRules: [
        {
          id: "RetainPostgresBackups",
          prefix: "postgres/",
          expiration: Duration.days(isProduction ? 35 : 14)
        }
      ]
    });

    const processingDeadLetterQueue = new sqs.Queue(this, "ProcessingDeadLetterQueue", {
      queueName: `${prefix}-image-processing-dlq`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(4)
    });
    const processingQueue = new sqs.Queue(this, "ProcessingQueue", {
      queueName: `${prefix}-image-processing`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: Duration.minutes(5),
      retentionPeriod: Duration.days(4),
      receiveMessageWaitTime: Duration.seconds(20),
      deadLetterQueue: {
        queue: processingDeadLetterQueue,
        maxReceiveCount: 3
      }
    });
    processingQueue.addToResourcePolicy(new iam.PolicyStatement({
      principals: [new iam.ServicePrincipal("s3.amazonaws.com")],
      actions: ["sqs:SendMessage"],
      resources: [processingQueue.queueArn],
      conditions: {
        ArnEquals: { "aws:SourceArn": imageBucket.bucketArn },
        StringEquals: { "aws:SourceAccount": this.account }
      }
    }));

    const googleSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "GoogleOAuthSecret",
      props.googleSecretName
    );

    const userPool = new cognito.UserPool(this, "UserPool", {
      userPoolName: `${prefix}-users`,
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: false, mutable: true }
      },
      signInPolicy: {
        allowedFirstAuthFactors: {
          password: true,
          emailOtp: true
        }
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: dataRemovalPolicy
    });

    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(
      this,
      "GoogleProvider",
      {
        userPool,
        clientId: googleSecret
          .secretValueFromJson("clientId")
          .unsafeUnwrap(),
        clientSecretValue: SecretValue.secretsManager(
          props.googleSecretName,
          { jsonField: "clientSecret" }
        ),
        scopes: ["openid", "email", "profile"],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          fullname: cognito.ProviderAttribute.GOOGLE_NAME
        }
      }
    );

    const userPoolClient = userPool.addClient("WebClient", {
      userPoolClientName: `${prefix}-web`,
      generateSecret: false,
      authFlows: { user: true },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
        cognito.UserPoolClientIdentityProvider.GOOGLE
      ],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE
        ],
        callbackUrls: [props.callbackUrl],
        logoutUrls: [props.logoutUrl]
      }
    });
    userPoolClient.node.addDependency(googleProvider);

    const userPoolDomain = userPool.addDomain("Domain", {
      cognitoDomain: { domainPrefix: `${prefix}-${this.account}` },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN
    });

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 1,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24
        }
      ]
    });

    const appSecurityGroup = new ec2.SecurityGroup(this, "AppSecurityGroup", {
      vpc,
      allowAllOutbound: true,
      description: "Public HTTP/HTTPS access for nginx; SSM is used for shell access."
    });
    appSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP to nginx");
    appSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), "HTTPS to nginx");

    const instanceRole = new iam.Role(this, "Ec2AppRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy")
      ]
    });
    imageBucket.grantReadWrite(instanceRole);
    processingQueue.grantConsumeMessages(instanceRole);
    backupBucket.grantPut(instanceRole, "postgres/*");
    backupBucket.grantRead(instanceRole, "postgres/*");
    instanceRole.addToPolicy(new iam.PolicyStatement({
      actions: ["cloudwatch:PutMetricData"],
      resources: ["*"],
      conditions: { StringEquals: { "cloudwatch:namespace": "ClosetHop/EC2" } }
    }));

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      "set -euxo pipefail",
      "dnf update -y",
      "dnf install -y docker docker-compose-plugin git amazon-cloudwatch-agent",
      "systemctl enable --now docker",
      "usermod -aG docker ec2-user",
      "mkdir -p /opt/closethop /data/closethop/postgres /data/closethop/backups",
      "chown -R ec2-user:ec2-user /opt/closethop /data/closethop",
      "DATA_DEVICE=$(lsblk -ndo NAME,TYPE,MOUNTPOINT | awk '$2==\"disk\" && $3==\"\" {print \"/dev/\"$1; exit}')",
      "if [ -n \"$DATA_DEVICE\" ] && ! blkid \"$DATA_DEVICE\"; then mkfs -t xfs \"$DATA_DEVICE\"; fi",
      "if [ -n \"$DATA_DEVICE\" ] && ! grep -q /data/closethop /etc/fstab; then echo \"UUID=$(blkid -s UUID -o value \"$DATA_DEVICE\") /data/closethop xfs defaults,nofail 0 2\" >> /etc/fstab; mount /data/closethop; chown -R ec2-user:ec2-user /data/closethop; fi",
      "cat >/opt/closethop/README-first-login.txt <<'EOF'",
      "Clone the repository into /opt/closethop/repo, create repo/deploy/ec2/.env from .env.example, then run docker compose from repo/deploy/ec2.",
      "EOF"
    );

    const appInstance = new ec2.Instance(this, "AppInstance", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      role: instanceRole,
      securityGroup: appSecurityGroup,
      userData,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(16, {
            encrypted: true,
            volumeType: ec2.EbsDeviceVolumeType.GP3
          })
        },
        {
          deviceName: "/dev/xvdf",
          volume: ec2.BlockDeviceVolume.ebs(20, {
            encrypted: true,
            volumeType: ec2.EbsDeviceVolumeType.GP3,
            deleteOnTermination: !isProduction
          })
        }
      ]
    });

    const processingQueueAgeAlarm = new cloudwatch.Alarm(this, "ProcessingQueueAgeAlarm", {
      alarmName: `${prefix}-image-processing-age`,
      metric: processingQueue.metricApproximateAgeOfOldestMessage(),
      threshold: 300,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    addAlarmAction(processingQueueAgeAlarm);
    const instanceStatusAlarm = new cloudwatch.Alarm(this, "Ec2StatusCheckAlarm", {
      alarmName: `${prefix}-ec2-status-check`,
      metric: new cloudwatch.Metric({
        namespace: "AWS/EC2",
        metricName: "StatusCheckFailed",
        dimensionsMap: { InstanceId: appInstance.instanceId },
        period: Duration.minutes(5),
        statistic: "Maximum"
      }),
      threshold: 1,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    addAlarmAction(instanceStatusAlarm);
    const instanceCpuAlarm = new cloudwatch.Alarm(this, "Ec2CpuAlarm", {
      alarmName: `${prefix}-ec2-cpu`,
      metric: new cloudwatch.Metric({
        namespace: "AWS/EC2",
        metricName: "CPUUtilization",
        dimensionsMap: { InstanceId: appInstance.instanceId },
        period: Duration.minutes(5),
        statistic: "Average"
      }),
      threshold: 80,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    addAlarmAction(instanceCpuAlarm);

    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;

    new CfnOutput(this, "ApiUrl", {
      value: `http://${appInstance.instancePublicDnsName}`
    });
    new CfnOutput(this, "Ec2InstanceId", { value: appInstance.instanceId });
    new CfnOutput(this, "Ec2PublicDnsName", { value: appInstance.instancePublicDnsName });
    new CfnOutput(this, "ImageBucketName", { value: imageBucket.bucketName });
    new CfnOutput(this, "DatabaseBackupBucketName", { value: backupBucket.bucketName });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.userPoolClientId
    });
    new CfnOutput(this, "CognitoIssuer", { value: issuer });
    new CfnOutput(this, "CognitoDomain", {
      value: userPoolDomain.baseUrl()
    });
    new CfnOutput(this, "OAuthCallbackUrl", { value: props.callbackUrl });
    new CfnOutput(this, "OAuthLogoutUrl", { value: props.logoutUrl });
    new CfnOutput(this, "GoogleOAuthCallbackUrl", {
      value: `${userPoolDomain.baseUrl()}/oauth2/idpresponse`
    });
    new CfnOutput(this, "ProcessingQueueUrl", { value: processingQueue.queueUrl });
    new CfnOutput(this, "ManualS3NotificationPrefix", { value: "users/" });
    if (alertTopic) {
      new CfnOutput(this, "AlertTopicArn", { value: alertTopic.topicArn });
    }
  }
}
