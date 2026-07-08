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

describe("ClosetHop EC2 Compose infrastructure", () => {
  test("does not provision managed application or database services", () => {
    const stack = template();
    stack.resourceCountIs("AWS::RDS::DBInstance", 0);
    stack.resourceCountIs("AWS::ECS::Cluster", 0);
    stack.resourceCountIs("AWS::ECS::ExpressGatewayService", 0);
    stack.resourceCountIs("AWS::EC2::NatGateway", 0);
  });

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

  test("keeps images and backups private", () => {
    const stack = template();
    stack.resourceCountIs("AWS::S3::Bucket", 2);
    stack.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true
      }
    });
    stack.hasResourceProperties("AWS::S3::Bucket", {
      LifecycleConfiguration: {
        Rules: Match.arrayWith([
          Match.objectLike({
            Id: "RetainPostgresBackups",
            Prefix: "postgres/"
          })
        ])
      }
    });
    stack.resourceCountIs("AWS::CloudFront::Distribution", 0);
  });

  test("provisions asynchronous image processing resources", () => {
    const stack = template();
    stack.resourceCountIs("AWS::SQS::Queue", 2);
    stack.hasResourceProperties("AWS::Lambda::Function", {
      PackageType: "Image",
      MemorySize: 4096,
      Timeout: 300,
      Environment: {
        Variables: Match.objectLike({
          VISION_PROVIDER: "gemini",
          RESULT_QUEUE_URL: Match.anyValue()
        })
      }
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
    stack.resourceCountIs("AWS::Lambda::EventSourceMapping", 1);
  });

  test("provisions an SSM-managed EC2 host for Docker Compose", () => {
    const stack = template();
    stack.resourceCountIs("AWS::EC2::Instance", 1);
    stack.hasResourceProperties("AWS::EC2::SecurityGroup", {
      SecurityGroupIngress: Match.arrayWith([
        Match.objectLike({ FromPort: 80, ToPort: 80 }),
        Match.objectLike({ FromPort: 443, ToPort: 443 })
      ])
    });
    stack.hasResourceProperties("AWS::EC2::Instance", {
      UserData: {
        "Fn::Base64": Match.stringLikeRegexp("docker")
      },
      BlockDeviceMappings: Match.arrayWith([
        Match.objectLike({
          DeviceName: "/dev/xvdf",
          Ebs: Match.objectLike({
            Encrypted: true,
            VolumeSize: 20
          })
        })
      ])
    });
    stack.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["sqs:ReceiveMessage", "sqs:DeleteMessage"])
          }),
          Match.objectLike({
            Action: Match.arrayWith(["s3:PutObject"])
          })
        ])
      }
    });
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
    stack.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "closethop-prod-ec2-status-check"
    });
    stack.hasOutput("AlertTopicArn", {});
  });
});
