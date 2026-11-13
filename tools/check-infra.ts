import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const template = JSON.parse(readFileSync('cdk.out/Memo.template.json', 'utf8'));
const resources = Object.values(template.Resources) as {
  Type: string;
  Properties: Record<string, unknown>;
}[];
assert.equal(
  resources.filter((resource) => resource.Type === 'AWS::KMS::Key').length,
  0,
);
assert.equal(
  resources.filter((resource) => resource.Type === 'AWS::DynamoDB::Table')
    .length,
  1,
);
const table = resources.find(
  (resource) => resource.Type === 'AWS::DynamoDB::Table',
)!.Properties;
assert.equal(table.BillingMode, 'PAY_PER_REQUEST');
assert.equal(table.DeletionProtectionEnabled, true);
const distribution = resources.find(
  (resource) => resource.Type === 'AWS::CloudFront::Distribution',
)!.Properties.DistributionConfig as {
  Logging?: unknown;
  CacheBehaviors: { PathPattern: string; CachePolicyId: string }[];
};
assert.equal(distribution.Logging, undefined);
for (const pattern of ['/api/*', '/mcp/*'])
  assert.equal(
    distribution.CacheBehaviors.find(
      (behavior) => behavior.PathPattern === pattern,
    )?.CachePolicyId,
    '4135ea2d-6df8-44a3-9df3-4b5a84be39ad',
  );
assert.equal(template.Parameters.VaultKey.NoEcho, true);
console.info('Infrastructure boundaries verified');
