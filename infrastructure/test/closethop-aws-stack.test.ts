import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ClosetHopAwsStack } from "../lib/closethop-aws-stack";

function template(): Template {
  const app = new App();
  const stack = new ClosetHopAwsStack(app, "TestStack", {
    environmentName: "dev",
    callbackUrl: "http://localhost:3000/auth/callback",
    logoutUrl: "http://localhost:3000",
    googleClientId: "google-client-id",
    googleClientSecret: "google-client-secret"
  });
  return Template.fromStack(stack);
}

describe("ClosetHop Render AWS infrastructure", () => {
  test("provisions only AWS dependencies, not compute or databases", () => {
    const stack = template();
    stack.resourceCountIs("AWS::EC2::Instance", 0);
    stack.resourceCountIs("AWS::ECS::Cluster", 0);
    stack.resourceCountIs("AWS::RDS::DBInstance", 0);
  });

  test("creates a private image bucket with upload-friendly CORS", () => {
    const stack = template();
    stack.resourceCountIs("AWS::S3::Bucket", 1);
    stack.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true
      },
      CorsConfiguration: {
        CorsRules: Match.arrayWith([
          Match.objectLike({
            AllowedMethods: ["GET", "HEAD", "PUT"],
            AllowedOrigins: Match.arrayWith([
              "http://localhost:3000",
              "http://localhost:5173"
            ])
          })
        ])
      }
    });
  });

  test("wires S3 object-created events into SQS with a DLQ", () => {
    const stack = template();
    stack.resourceCountIs("AWS::SQS::Queue", 2);
    stack.hasResourceProperties("AWS::SQS::QueuePolicy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: { Service: "s3.amazonaws.com" },
            Action: "sqs:SendMessage"
          })
        ])
      }
    });
    stack.resourceCountIs("Custom::S3BucketNotifications", 0);
    stack.resourceCountIs("AWS::Lambda::Function", 0);
  });

  test("configures Cognito for email OTP and Google sign-in", () => {
    const stack = template();
    stack.hasResourceProperties("AWS::Cognito::UserPool", {
      UsernameAttributes: ["email"],
      AutoVerifiedAttributes: ["email"],
      Policies: {
        SignInPolicy: {
          AllowedFirstAuthFactors: Match.arrayWith(["EMAIL_OTP"])
        }
      }
    });
    stack.resourceCountIs("AWS::Cognito::UserPoolIdentityProvider", 1);
    stack.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      AllowedOAuthFlows: ["code"],
      AllowedOAuthScopes: Match.arrayWith(["openid", "email", "profile"]),
      CallbackURLs: ["http://localhost:3000/auth/callback"],
      ExplicitAuthFlows: Match.arrayWith(["ALLOW_USER_AUTH"])
    });
    stack.hasResourceProperties("AWS::Cognito::UserPoolDomain", {});
  });

  test("exports Render and Vercel configuration values", () => {
    const stack = template();
    stack.hasOutput("ImageBucketName", {});
    stack.hasOutput("ProcessingQueueUrl", {});
    stack.hasOutput("ProcessingQueueArn", {});
    stack.hasOutput("UserPoolId", {});
    stack.hasOutput("UserPoolClientId", {});
    stack.hasOutput("CognitoIssuer", {});
    stack.hasOutput("CognitoDomain", {});
    stack.hasOutput("GoogleOAuthCallbackUrl", {});
    stack.hasOutput("ManualS3NotificationEvent", { Value: "s3:ObjectCreated:*" });
    stack.hasOutput("ManualS3NotificationPrefix", { Value: "users/" });
    stack.hasOutput("OAuthCallbackUrl", { Value: "http://localhost:3000/auth/callback" });
    stack.hasOutput("OAuthLogoutUrl", { Value: "http://localhost:3000" });
  });
});
