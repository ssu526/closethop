import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ClosetHopDevStack } from "../lib/closethop-dev-stack";

function template(): Template {
  const app = new App();
  const stack = new ClosetHopDevStack(app, "TestStack", {
    environmentName: "dev",
    callbackUrl: "http://localhost:3000/auth/callback",
    logoutUrl: "http://localhost:3000",
    googleSecretName: "closethop/dev/google-oauth",
    geminiSecretName: "closethop/dev/gemini"
  });
  return Template.fromStack(stack);
}

function alertTemplate(): Template {
  const app = new App();
  const stack = new ClosetHopDevStack(app, "AlertStack", {
    environmentName: "prod",
    callbackUrl: "https://app.example.com/auth/callback",
    logoutUrl: "https://app.example.com",
    googleSecretName: "closethop/prod/google-oauth",
    geminiSecretName: "closethop/prod/gemini",
    alertEmail: "alerts@example.com"
  });
  return Template.fromStack(stack);
}

describe("ClosetHop dev infrastructure", () => {
  test("configures passwordless Cognito and Google OAuth", () => {
    const stack = template();
    stack.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolTier: "ESSENTIALS",
      Policies: {
        SignInPolicy: {
          AllowedFirstAuthFactors: Match.arrayWith(["EMAIL_OTP"])
        }
      }
    });
    stack.resourceCountIs("AWS::Cognito::UserPoolIdentityProvider", 1);
    stack.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      AllowedOAuthFlows: ["code"],
      GenerateSecret: false,
      CallbackURLs: ["http://localhost:3000/auth/callback"]
    });
  });

  test("keeps images private for signed URL access", () => {
    const stack = template();
    stack.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: Match.anyValue(),
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true
      }
    });
    stack.resourceCountIs("AWS::CloudFront::Distribution", 0);
  });

  test("provisions private PostgreSQL and ECS Express", () => {
    const stack = template();
    stack.hasResourceProperties("AWS::RDS::DBInstance", {
      Engine: "postgres",
      StorageEncrypted: true,
      PubliclyAccessible: false
    });
    stack.hasResourceProperties("AWS::ECS::ExpressGatewayService", {
      HealthCheckPath: "/actuator/health",
      PrimaryContainer: Match.objectLike({
        ContainerPort: 8080,
        Secrets: Match.arrayWith([
          Match.objectLike({ Name: "DATASOURCE_PASSWORD" })
        ])
      })
    });
  });

  test("grants task access to the image bucket", () => {
    const stack = template();
    stack.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["s3:GetObject*", "s3:PutObject"])
          })
        ])
      }
    });
  });

  test("provisions asynchronous image processing resources", () => {
    const stack = template();
    stack.resourceCountIs("AWS::SQS::Queue", 4);
    stack.hasResourceProperties("AWS::Lambda::Function", {
      PackageType: "Image",
      MemorySize: 4096,
      Timeout: 300
    });
    stack.resourceCountIs("AWS::DynamoDB::Table", 0);
    stack.hasResourceProperties("AWS::Lambda::Function", {
      VpcConfig: Match.anyValue()
    });
    stack.hasResourceProperties("AWS::Lambda::EventSourceMapping", {
      BatchSize: 1,
      FunctionResponseTypes: ["ReportBatchItemFailures"]
    });
    stack.hasResourceProperties("Custom::S3BucketNotifications", {
      NotificationConfiguration: {
        QueueConfigurations: Match.arrayWith([
          Match.objectLike({
            Events: ["s3:ObjectCreated:*"],
            Filter: {
              Key: {
                FilterRules: [{ Name: "prefix", Value: "staging/" }]
              }
            }
          })
        ])
      }
    });
    stack.resourceCountIs("AWS::Lambda::EventSourceMapping", 2);
  });

  test("optionally routes alarms to an email SNS subscription", () => {
    const stack = alertTemplate();
    stack.hasResourceProperties("AWS::SNS::Topic", {
      TopicName: "closethop-prod-alerts",
      DisplayName: "ClosetHop prod alerts"
    });
    stack.hasResourceProperties("AWS::SNS::Subscription", {
      Protocol: "email",
      Endpoint: "alerts@example.com"
    });
    stack.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "closethop-prod-image-worker-errors",
      AlarmActions: Match.arrayWith([{ Ref: Match.stringLikeRegexp("AlertTopic") }])
    });
    stack.hasOutput("AlertTopicArn", {});
  });
});
