#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ClosetHopAwsStack } from "../lib/closethop-aws-stack";

const app = new cdk.App();
const environmentName = app.node.tryGetContext("environmentName") ?? "dev";
const callbackUrl =
  app.node.tryGetContext("callbackUrl") ?? "http://localhost:3000/auth/callback";
const logoutUrl =
  app.node.tryGetContext("logoutUrl") ?? "http://localhost:3000";
const googleClientId =
  app.node.tryGetContext("googleClientId") ?? process.env.GOOGLE_CLIENT_ID;
const googleClientSecret =
  app.node.tryGetContext("googleClientSecret") ?? process.env.GOOGLE_CLIENT_SECRET;

if (!googleClientId || !googleClientSecret) {
  throw new Error(
    "Provide googleClientId/googleClientSecret via CDK context or GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET environment variables."
  );
}

new ClosetHopAwsStack(app, `ClosetHopAws-${environmentName}`, {
  description: "ClosetHop AWS dependencies for the Render-based deployment",
  environmentName,
  callbackUrl,
  logoutUrl,
  googleClientId,
  googleClientSecret
});
