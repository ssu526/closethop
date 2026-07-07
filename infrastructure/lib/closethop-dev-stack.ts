import * as path from "path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  SecretValue,
  Size,
  Stack,
  StackProps
} from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3Notifications from "aws-cdk-lib/aws-s3-notifications";
import * as sns from "aws-cdk-lib/aws-sns";
import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
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
      if (alertTopic) {
        alarm.addAlarmAction(new cloudwatchActions.SnsAction(alertTopic));
      }
    };

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24
        },
        {
          name: "application",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24
        },
        {
          name: "database",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24
        }
      ]
    });

    const imageBucket = new s3.Bucket(this, "ImageBucket", {
      bucketName: `${prefix}-images-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: isProduction,
      removalPolicy: dataRemovalPolicy,
      autoDeleteObjects: !isProduction,
      lifecycleRules: [{
        id: "ExpireStagingUploads",
        prefix: "staging/",
        abortIncompleteMultipartUploadAfter: Duration.days(1)
      }]
    });

    const processingDlq = new sqs.Queue(this, "ProcessingDlq", {
      queueName: `${prefix}-image-processing-dlq`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14)
    });
    const processingQueue = new sqs.Queue(this, "ProcessingQueue", {
      queueName: `${prefix}-image-processing`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: Duration.minutes(6),
      deadLetterQueue: { queue: processingDlq, maxReceiveCount: 3 }
    });
    const resultDlq = new sqs.Queue(this, "ProcessingResultDlq", {
      queueName: `${prefix}-image-processing-results-dlq`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14)
    });
    const resultQueue = new sqs.Queue(this, "ProcessingResultQueue", {
      queueName: `${prefix}-image-processing-results`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: Duration.seconds(30),
      retentionPeriod: Duration.days(4),
      deadLetterQueue: {
        queue: resultDlq,
        maxReceiveCount: 5
      }
    });
    imageBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3Notifications.SqsDestination(processingQueue),
      { prefix: "staging/" }
    );
    const geminiSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "GeminiApiSecret",
      props.geminiSecretName
    );
    const workerLogGroup = new logs.LogGroup(this, "ImageWorkerLogs", {
      logGroupName: `/aws/lambda/${prefix}-image-worker`,
      retention: isProduction ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy: dataRemovalPolicy
    });
    const dlqWorker = new lambda.DockerImageFunction(this, "ImageWorkerDlqConsumer", {
      functionName: `${prefix}-image-worker-dlq`,
      code: lambda.DockerImageCode.fromImageAsset(
        path.join(__dirname, "../.."),
        {
          file: "worker/Dockerfile",
          platform: ecrAssets.Platform.LINUX_AMD64,
          cmd: ["app.dlq_handler"]
        }
      ),
      architecture: lambda.Architecture.X86_64,
      memorySize: 512,
      timeout: Duration.seconds(30),
      environment: {
        IMAGE_BUCKET: imageBucket.bucketName,
        RESULT_QUEUE_URL: resultQueue.queueUrl,
        PUBLIC_URL: "",
        GEMINI_SECRET_ARN: geminiSecret.secretArn
      }
    });
    dlqWorker.addEventSource(new lambdaEventSources.SqsEventSource(processingDlq, {
      batchSize: 10,
      reportBatchItemFailures: true
    }));
    resultQueue.grantSendMessages(dlqWorker);
    const processingDlqAlarm = new cloudwatch.Alarm(this, "ProcessingDlqAlarm", {
      alarmName: `${prefix}-image-processing-dlq`,
      metric: processingDlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    addAlarmAction(processingDlqAlarm);
    const processingResultDlqAlarm = new cloudwatch.Alarm(this, "ProcessingResultDlqAlarm", {
      alarmName: `${prefix}-image-processing-results-dlq`,
      metric: resultDlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    addAlarmAction(processingResultDlqAlarm);

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

    const googleSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "GoogleOAuthSecret",
      props.googleSecretName
    );

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
      cognitoDomain: {
        domainPrefix: `${prefix}-${this.account}`
      },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN
    });

    const databaseSecurityGroup = new ec2.SecurityGroup(
      this,
      "DatabaseSecurityGroup",
      { vpc, allowAllOutbound: false }
    );
    const serviceSecurityGroup = new ec2.SecurityGroup(
      this,
      "ServiceSecurityGroup",
      { vpc, allowAllOutbound: true }
    );
    const workerSecurityGroup = new ec2.SecurityGroup(
      this,
      "WorkerSecurityGroup",
      { vpc, allowAllOutbound: true }
    );
    databaseSecurityGroup.addIngressRule(
      serviceSecurityGroup,
      ec2.Port.tcp(5432),
      "Spring Boot service access"
    );
    databaseSecurityGroup.addIngressRule(
      workerSecurityGroup,
      ec2.Port.tcp(5432),
      "Image worker access"
    );

    const database = new rds.DatabaseInstance(this, "Database", {
      databaseName: "closethop",
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO
      ),
      credentials: rds.Credentials.fromGeneratedSecret("closethop"),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      multiAz: isProduction,
      backupRetention: Duration.days(isProduction ? 7 : 1),
      deletionProtection: isProduction,
      removalPolicy: dataRemovalPolicy,
      deleteAutomatedBackups: !isProduction
    });
    const databaseCpuAlarm = new cloudwatch.Alarm(this, "DatabaseCpuAlarm", {
      alarmName: `${prefix}-database-cpu`,
      metric: database.metricCPUUtilization(),
      threshold: 80,
      evaluationPeriods: 3
    });
    addAlarmAction(databaseCpuAlarm);
    const databaseStorageAlarm = new cloudwatch.Alarm(this, "DatabaseStorageAlarm", {
      alarmName: `${prefix}-database-free-storage`,
      metric: database.metricFreeStorageSpace(),
      threshold: 5 * 1024 * 1024 * 1024,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1
    });
    addAlarmAction(databaseStorageAlarm);
    const databaseConnectionsAlarm = new cloudwatch.Alarm(this, "DatabaseConnectionsAlarm", {
      alarmName: `${prefix}-database-connections`,
      metric: database.metricDatabaseConnections(),
      threshold: 60,
      evaluationPeriods: 2
    });
    addAlarmAction(databaseConnectionsAlarm);

    const imageWorker = new lambda.DockerImageFunction(this, "ImageWorker", {
      functionName: `${prefix}-image-worker`,
      code: lambda.DockerImageCode.fromImageAsset(
        path.join(__dirname, "../.."),
        {
          file: "worker/Dockerfile",
          platform: ecrAssets.Platform.LINUX_AMD64
        }
      ),
      architecture: lambda.Architecture.X86_64,
      memorySize: 4096,
      timeout: Duration.minutes(5),
      ephemeralStorageSize: Size.gibibytes(10),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [workerSecurityGroup],
      environment: {
        IMAGE_BUCKET: imageBucket.bucketName,
        RESULT_QUEUE_URL: resultQueue.queueUrl,
        PUBLIC_URL: "",
        GEMINI_SECRET_ARN: geminiSecret.secretArn,
        DATASOURCE_SECRET_ARN: database.secret!.secretArn,
        DATASOURCE_DB_NAME: "closethop",
        VISION_PROVIDER: "gemini",
        VISION_MODEL: "gemini-2.5-flash-lite",
        VISION_SCHEMA_VERSION: "2",
        CLASSIFICATION_PROMPT_PATH: "/prompts/clothing_classifier_prompt.txt",
        U2NET_HOME: "/opt/rembg-models"
      },
      logGroup: workerLogGroup
    });
    imageWorker.addEventSource(new lambdaEventSources.SqsEventSource(processingQueue, {
      batchSize: 1,
      reportBatchItemFailures: true
    }));
    imageBucket.grantReadWrite(imageWorker);
    resultQueue.grantSendMessages(imageWorker);
    geminiSecret.grantRead(imageWorker);
    database.secret?.grantRead(imageWorker);
    imageWorker.addToRolePolicy(new iam.PolicyStatement({
      actions: ["cloudwatch:PutMetricData"],
      resources: ["*"],
      conditions: { StringEquals: { "cloudwatch:namespace": "ClosetHop/ImageProcessing" } }
    }));
    const imageWorkerErrorsAlarm = new cloudwatch.Alarm(this, "ImageWorkerErrorsAlarm", {
      alarmName: `${prefix}-image-worker-errors`,
      metric: imageWorker.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    addAlarmAction(imageWorkerErrorsAlarm);
    const processingQueueAgeAlarm = new cloudwatch.Alarm(this, "ProcessingQueueAgeAlarm", {
      alarmName: `${prefix}-image-processing-age`,
      metric: processingQueue.metricApproximateAgeOfOldestMessage(),
      threshold: 300,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    addAlarmAction(processingQueueAgeAlarm);
    const resultQueueAgeAlarm = new cloudwatch.Alarm(this, "ResultQueueAgeAlarm", {
      alarmName: `${prefix}-image-result-age`,
      metric: resultQueue.metricApproximateAgeOfOldestMessage(),
      threshold: 120,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    addAlarmAction(resultQueueAgeAlarm);

    const backendImage = new ecrAssets.DockerImageAsset(
      this,
      "BackendImage",
      {
        directory: path.join(__dirname, "../.."),
        file: "backend/Dockerfile",
        platform: ecrAssets.Platform.LINUX_AMD64
      }
    );

    const executionRole = new iam.Role(this, "ExecutionRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSTaskExecutionRolePolicy"
        )
      ]
    });
    backendImage.repository.grantPull(executionRole);
    database.secret?.grantRead(executionRole);
    geminiSecret.grantRead(executionRole);

    const taskRole = new iam.Role(this, "TaskRole", {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com")
    });
    imageBucket.grantReadWrite(taskRole);
    resultQueue.grantConsumeMessages(taskRole);

    const infrastructureRole = new iam.Role(this, "InfrastructureRole", {
      assumedBy: new iam.ServicePrincipal("ecs.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AmazonECSInfrastructureRoleforExpressGatewayServices"
        )
      ]
    });

    const logGroup = new logs.LogGroup(this, "BackendLogs", {
      logGroupName: `/ecs/${prefix}-backend`,
      retention: isProduction ? logs.RetentionDays.ONE_MONTH : logs.RetentionDays.ONE_WEEK,
      removalPolicy: dataRemovalPolicy
    });

    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      clusterName: `${prefix}-cluster`,
      containerInsightsV2: ecs.ContainerInsights.ENABLED
    });

    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;
    const databaseUrl = `jdbc:postgresql://${database.dbInstanceEndpointAddress}:${database.dbInstanceEndpointPort}/closethop`;

    const service = new ecs.CfnExpressGatewayService(
      this,
      "BackendService",
      {
        serviceName: `${prefix}-backend`,
        cluster: cluster.clusterArn,
        executionRoleArn: executionRole.roleArn,
        infrastructureRoleArn: infrastructureRole.roleArn,
        taskRoleArn: taskRole.roleArn,
        cpu: "512",
        memory: "1024",
        healthCheckPath: "/actuator/health",
        networkConfiguration: {
          securityGroups: [serviceSecurityGroup.securityGroupId],
          subnets: vpc.privateSubnets.map(subnet => subnet.subnetId)
        },
        scalingTarget: {
          autoScalingMetric: "CPU",
          autoScalingTargetValue: 60,
          minTaskCount: 1,
          maxTaskCount: 3
        },
        primaryContainer: {
          image: backendImage.imageUri,
          containerPort: 8080,
          environment: [
            { name: "SPRING_PROFILES_ACTIVE", value: "aws" },
            { name: "SERVER_PORT", value: "8080" },
            { name: "DATASOURCE_URL", value: databaseUrl },
            { name: "AWS_REGION", value: this.region },
            { name: "AWS_S3_BUCKET", value: imageBucket.bucketName },
            { name: "PROCESSING_RESULT_QUEUE_URL", value: resultQueue.queueUrl },
            {
              name: "AWS_PUBLIC_URL",
              value: ""
            },
            { name: "COGNITO_ISSUER", value: issuer },
            { name: "COGNITO_CLIENT_ID", value: userPoolClient.userPoolClientId },
            { name: "OUTFIT_AI_MODEL", value: "gemini-2.5-flash-lite" },
            { name: "OUTFIT_SUGGESTION_PROMPT_PATH", value: "classpath:prompts/outfit_suggestion_prompt.txt" },
            { name: "CORS_ALLOWED_ORIGINS", value: new URL(props.callbackUrl).origin }
          ],
          secrets: [
            {
              name: "DATASOURCE_USERNAME",
              valueFrom: `${database.secret!.secretArn}:username::`
            },
            {
              name: "DATASOURCE_PASSWORD",
              valueFrom: `${database.secret!.secretArn}:password::`
            },
            {
              name: "GEMINI_API_KEY",
              valueFrom: `${geminiSecret.secretArn}:apiKey::`
            }
          ],
          awsLogsConfiguration: {
            logGroup: logGroup.logGroupName,
            logStreamPrefix: "backend"
          }
        }
      }
    );
    service.node.addDependency(database);
    service.node.addDependency(logGroup);

    new CfnOutput(this, "ApiUrl", { value: service.attrEndpoint });
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
    new CfnOutput(this, "ProcessingDlqUrl", { value: processingDlq.queueUrl });
    if (alertTopic) {
      new CfnOutput(this, "AlertTopicArn", { value: alertTopic.topicArn });
    }
  }
}
