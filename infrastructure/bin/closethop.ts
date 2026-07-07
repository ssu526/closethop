#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { ClosetHopDevStack } from "../lib/closethop-dev-stack";

const app = new cdk.App();
const environment = app.node.tryGetContext("environment") ?? "dev";
const configuredCallbackUrl = app.node.tryGetContext("callbackUrl");
const configuredLogoutUrl = app.node.tryGetContext("logoutUrl");
const configuredGoogleSecret = app.node.tryGetContext("googleSecretName");
const configuredGeminiSecret = app.node.tryGetContext("geminiSecretName");
const configuredAlertEmail = app.node.tryGetContext("alertEmail");

if (environment === "prod" && (
  !configuredCallbackUrl ||
  !configuredLogoutUrl ||
  !configuredGoogleSecret ||
  !configuredGeminiSecret
)) {
  throw new Error(
    "Production requires callbackUrl, logoutUrl, googleSecretName, and geminiSecretName contexts"
  );
}

new ClosetHopDevStack(app, `ClosetHop-${environment}`, {
  description: "ClosetHop application AWS foundation",
  environmentName: environment,
  callbackUrl:
    configuredCallbackUrl ??
    "http://localhost:3000/auth/callback",
  logoutUrl:
    configuredLogoutUrl ?? "http://localhost:3000",
  googleSecretName:
    configuredGoogleSecret ??
    "closethop/dev/google-oauth",
  geminiSecretName:
    configuredGeminiSecret ??
    "closethop/dev/gemini",
  alertEmail: configuredAlertEmail
});
