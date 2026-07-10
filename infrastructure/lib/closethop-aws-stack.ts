import { CfnOutput, Duration, RemovalPolicy, SecretValue, Stack, StackProps } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

export interface ClosetHopAwsStackProps extends StackProps {
  environmentName: string;
  callbackUrl: string;
  logoutUrl: string;
  googleClientId: string;
  googleClientSecret: string;
}

export class ClosetHopAwsStack extends Stack {
  constructor(scope: Construct, id: string, props: ClosetHopAwsStackProps) {
    super(scope, id, props);

    const prefix = `closethop-${props.environmentName}`;
    const frontendOrigin = new URL(props.callbackUrl).origin;
    const retainData = props.environmentName === "prod";
    const removalPolicy = retainData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const imageBucket = new s3.Bucket(this, "ImageBucket", {
      bucketName: `${prefix}-images-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: retainData,
      removalPolicy,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD, s3.HttpMethods.PUT],
          allowedOrigins: [frontendOrigin, "http://localhost:3000", "http://localhost:5173"],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
          maxAge: 300
        }
      ],
      lifecycleRules: [
        {
          id: "AbortIncompleteUserUploads",
          prefix: "users/",
          abortIncompleteMultipartUploadAfter: Duration.days(1)
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

    processingQueue.addToResourcePolicy(
      new iam.PolicyStatement({
        principals: [new iam.ServicePrincipal("s3.amazonaws.com")],
        actions: ["sqs:SendMessage"],
        resources: [processingQueue.queueArn],
        conditions: {
          ArnEquals: { "aws:SourceArn": imageBucket.bucketArn },
          StringEquals: { "aws:SourceAccount": this.account }
        }
      })
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
      removalPolicy
    });

    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, "GoogleProvider", {
      userPool,
      clientId: props.googleClientId,
      clientSecretValue: SecretValue.unsafePlainText(props.googleClientSecret),
      scopes: ["openid", "email", "profile"],
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
        fullname: cognito.ProviderAttribute.GOOGLE_NAME
      }
    });

    const userPoolClient = userPool.addClient("WebClient", {
      userPoolClientName: `${prefix}-web`,
      generateSecret: false,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      authFlows: { user: true },
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

    const cfnClient = userPoolClient.node.defaultChild as cognito.CfnUserPoolClient;
    cfnClient.explicitAuthFlows = [
      "ALLOW_USER_AUTH",
      "ALLOW_REFRESH_TOKEN_AUTH"
    ];

    const userPoolDomain = userPool.addDomain("Domain", {
      cognitoDomain: { domainPrefix: `${prefix}-${this.account}` },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN
    });

    const issuer = `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`;

    new CfnOutput(this, "ImageBucketName", { value: imageBucket.bucketName });
    new CfnOutput(this, "ProcessingQueueUrl", { value: processingQueue.queueUrl });
    new CfnOutput(this, "ProcessingQueueArn", { value: processingQueue.queueArn });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "CognitoIssuer", { value: issuer });
    new CfnOutput(this, "CognitoDomain", { value: userPoolDomain.baseUrl() });
    new CfnOutput(this, "GoogleOAuthCallbackUrl", {
      value: `${userPoolDomain.baseUrl()}/oauth2/idpresponse`
    });
    new CfnOutput(this, "ManualS3NotificationEvent", { value: "s3:ObjectCreated:*" });
    new CfnOutput(this, "ManualS3NotificationPrefix", { value: "users/" });
    new CfnOutput(this, "FrontendOrigin", { value: frontendOrigin });
    new CfnOutput(this, "OAuthCallbackUrl", { value: props.callbackUrl });
    new CfnOutput(this, "OAuthLogoutUrl", { value: props.logoutUrl });
  }
}
