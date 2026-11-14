import {
  App,
  Stack,
  CfnParameter,
  CfnOutput,
  Duration,
  RemovalPolicy,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as deployment from 'aws-cdk-lib/aws-s3-deployment';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import { resolve } from 'node:path';

const domain = 'memo.anipopina.com';
const account = process.env.CDK_DEFAULT_ACCOUNT;
function hostedZone(scope: Stack) {
  const id = new CfnParameter(scope, 'HostedZoneId', {
    type: 'String',
    description: 'Existing anipopina.com hosted zone ID. No zone is created.',
  });
  return route53.HostedZone.fromHostedZoneAttributes(scope, 'Zone', {
    hostedZoneId: id.valueAsString,
    zoneName: 'anipopina.com',
  });
}

export class MemoCertificateStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      env: { region: 'us-east-1', account },
      terminationProtection: true,
    });
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: domain,
      validation: acm.CertificateValidation.fromDns(hostedZone(this)),
    });
    new CfnOutput(this, 'CertificateArn', {
      value: certificate.certificateArn,
    });
  }
}

export class MemoStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id, {
      env: { region: 'ap-northeast-1', account },
      terminationProtection: true,
    });
    const zone = hostedZone(this);
    const certificateArn = new CfnParameter(this, 'CertificateArn', {
      type: 'String',
      allowedPattern: 'arn:aws:acm:us-east-1:[0-9]{12}:certificate/[a-f0-9-]+',
      description: 'CertificateArn output from MemoCertificate in us-east-1.',
    });
    const vaultKey = new CfnParameter(this, 'VaultKey', {
      type: 'String',
      noEcho: true,
      allowedPattern: '[A-Za-z0-9+/]{43}=',
      description:
        'Base64-encoded 32 random bytes. Supply securely at deployment; keep an offline backup.',
    });
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'Certificate',
      certificateArn.valueAsString,
    );
    const table = new dynamodb.Table(this, 'Data', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'expires',
      encryption: dynamodb.TableEncryption.DEFAULT,
      removalPolicy: RemovalPolicy.RETAIN,
      deletionProtection: true,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });
    const logGroup = new logs.LogGroup(this, 'Errors', {
      retention: logs.RetentionDays.THREE_DAYS,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const backend = new lambda.Function(this, 'ApiFunction', {
      code: lambda.Code.fromAsset(resolve('dist/server')),
      handler: 'index.handler',
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(28),
      logGroup,
      loggingFormat: lambda.LoggingFormat.JSON,
      systemLogLevelV2: lambda.SystemLogLevel.WARN,
      applicationLogLevelV2: lambda.ApplicationLogLevel.ERROR,
      environment: {
        MEMO_TABLE: table.tableName,
        MEMO_ORIGIN: `https://${domain}`,
        MEMO_VAULT_KEY: vaultKey.valueAsString,
      },
    });
    table.grantReadWriteData(backend);
    const api = new apigateway.HttpApi(this, 'HttpApi', {
      createDefaultStage: false,
    });
    new apigateway.HttpStage(this, 'Stage', {
      httpApi: api,
      stageName: '$default',
      autoDeploy: true,
      throttle: { burstLimit: 30, rateLimit: 15 },
    });
    api.addRoutes({
      path: '/{proxy+}',
      integration: new HttpLambdaIntegration('Backend', backend),
      methods: [apigateway.HttpMethod.ANY],
    });
    const bucket = new s3.Bucket(this, 'Web', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const rewrite = new cloudfront.Function(this, 'Route', {
      code: cloudfront.FunctionCode.fromInline(
        "function handler(event){var r=event.request;if(/^\\/(?:[A-Za-z0-9_-]{22}|connect)?$/.test(r.uri)){r.uri='/index.html';}return r;}",
      ),
    });
    const headers = new cloudfront.ResponseHeadersPolicy(this, 'Headers', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy:
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
          override: true,
        },
        contentTypeOptions: { override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: false,
          override: true,
        },
        frameOptions: {
          frameOption: cloudfront.HeadersFrameOption.DENY,
          override: true,
        },
      },
      customHeadersBehavior: {
        customHeaders: [
          {
            header: 'X-Robots-Tag',
            value: 'noindex, nofollow, noarchive',
            override: true,
          },
          {
            header: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
            override: true,
          },
        ],
      },
    });
    const apiHost = `${api.apiId}.execute-api.${this.region}.${this.urlSuffix}`;
    const apiBehavior: cloudfront.BehaviorOptions = {
      origin: new origins.HttpOrigin(apiHost),
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy:
        cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      responseHeadersPolicy: headers,
    };
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      domainNames: [domain],
      certificate,
      enableLogging: false,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
        functionAssociations: [
          {
            function: rewrite,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        '/api/*': apiBehavior,
        '/mcp/*': apiBehavior,
        '/.well-known/*': apiBehavior,
      },
    });
    new deployment.BucketDeployment(this, 'Release', {
      sources: [deployment.Source.asset(resolve('dist/web'))],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],
      prune: true,
      retainOnDelete: true,
      cacheControl: [
        deployment.CacheControl.fromString('public,max-age=0,must-revalidate'),
      ],
    });
    new route53.ARecord(this, 'Alias', {
      zone,
      recordName: 'memo',
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });
    new route53.AaaaRecord(this, 'AliasV6', {
      zone,
      recordName: 'memo',
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    });
    new CfnOutput(this, 'Url', { value: `https://${domain}` });
  }
}
const app = new App();
new MemoCertificateStack(app, 'MemoCertificate');
new MemoStack(app, 'Memo');
