import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { X509Certificate } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
assert.ok(root, 'Provide the verification checkout');
const require = createRequire(pathToFileURL(`${root}/package.json`));
const sdkRequire = createRequire(require.resolve('@sap-cloud-sdk/connectivity'));
const jks = sdkRequire('jks-js');
const forge = createRequire(sdkRequire.resolve('jks-js'))('node-forge');
const { getAgentConfig } = require('@sap-cloud-sdk/connectivity');
const { resolveUserDestination } = await import(pathToFileURL(`${root}/dist/src/user-destination.js`));
const originalSet = forge.pki.setRsaPublicKey;
const originalRsaSet = forge.pki.rsa.setPublicKey;
const originalParser = forge.pkcs12.pkcs12FromAsn1;
const originalJks = jks.toPem;
let rsaVerify = 0, pkcs12Parse = 0, jksConvert = 0;
function trackedSet(...args) {
  const key = originalSet(...args), originalVerify = key.verify;
  key.verify = function (...args) { rsaVerify++; return originalVerify.apply(this, args); };
  return key;
}
forge.pki.setRsaPublicKey = forge.pki.rsa.setPublicKey = trackedSet;
forge.pkcs12.pkcs12FromAsn1 = function (...args) { pkcs12Parse++; return originalParser.apply(this,args); };
jks.toPem = function (...args) { jksConvert++; return originalJks.apply(this,args); };
const rows = [];
try {
  const keys = forge.pki.rsa.generateKeyPair({bits:2048,e:65537});
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2028-01-01T00:00:00Z');
  cert.setSubject([{name:'commonName',value:'fixture.invalid'}]);
  cert.setIssuer(cert.subject.attributes); cert.sign(keys.privateKey,forge.md.sha256.create());
  const pem = forge.pki.certificateToPem(cert);
  const parsed = forge.pki.certificateFromPem(pem);
  assert.equal(parsed.verify(parsed),true); assert.equal(rsaVerify,1);
  rows.push({name:'RSA instrumentation positive control',rsaVerify,passed:true});
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey,[cert],'fixture-only',{algorithm:'3des',friendlyName:'fixture'});
  const content = Buffer.from(forge.asn1.toDer(p12).getBytes(),'binary').toString('base64');
  const options = {url:'https://fixture.invalid',keyStoreName:'fixture.jks',keyStorePassword:'fixture-only',
    certificates:[{name:'fixture.jks',content,type:'CERTIFICATE'}]};
  for (const authentication of ['OAuth2UserTokenExchange','PrincipalPropagation','ClientCertificateAuthentication']) {
    rsaVerify = pkcs12Parse = jksConvert = 0;
    const agents = await getAgentConfig({...options,authentication});
    assert.equal(agents.httpsAgent.options.rejectUnauthorized,true);
    assert.equal(rsaVerify,0);
    assert.equal(jksConvert,authentication==='ClientCertificateAuthentication'?1:0);
    assert.equal(pkcs12Parse,jksConvert);
    rows.push({name:`SDK agent ${authentication}`,rsaVerify,pkcs12Parse,jksConvert,
      transportCalls:0,passed:true});
    agents.httpsAgent.destroy();
  }
  rsaVerify = pkcs12Parse = jksConvert = 0;
  await assert.rejects(resolveUserDestination({destinationName:'FIXTURE',expectedUrl:options.url,sapClient:'100',
    authentication:'OAuth2UserTokenExchange',userJwt:'fixture-user-token'},
    {getDestinationFromDestinationService:async()=>({...options,authentication:'ClientCertificateAuthentication'}),alwaysSubscriber(){}}),
    error=>error.code==='DESTINATION_MISMATCH');
  assert.equal(rsaVerify+pkcs12Parse+jksConvert,0);
  rows.push({name:'Product policy refuses certificate destination',rsaVerify,pkcs12Parse,jksConvert,passed:true});
  const native = new X509Certificate(pem);
  assert.equal(native.verify(native.publicKey),true);
  const changed = Buffer.from(native.raw); changed[changed.length-1] ^= 1;
  assert.equal(new X509Certificate(changed).verify(native.publicKey),false);
  assert.equal(rsaVerify,0);
  rows.push({name:'Native certificate verification accepts valid signature and refuses changed signature',rsaVerify,passed:true});
  console.log(JSON.stringify({passed:true,node:process.version,platform:process.platform,
    sdk:require('@sap-cloud-sdk/connectivity/package.json').version,forge:require('node-forge/package.json').version,
    rows,liveSapCalls:0,liveIdpCalls:0,networkCalls:0,credentialsPersisted:0,
    limits:['Synthetic certificates and agent construction, no live TLS handshake','Not an exploit reproduction or proof of all SDK binding authentication paths','Affected package warning remains open']},null,2));
} finally {
  forge.pki.setRsaPublicKey = originalSet; forge.pki.rsa.setPublicKey = originalRsaSet;
  forge.pkcs12.pkcs12FromAsn1 = originalParser; jks.toPem = originalJks;
}
