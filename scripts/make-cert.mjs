// Generates tests/fixtures/test-cert.p12: a self-signed RSA certificate
// (CN "Test Signer", password "test") for the digital signature tests.
import { writeFileSync } from 'node:fs';
import forge from 'node-forge';

const keys = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01';
cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
cert.validity.notAfter = new Date('2036-01-01T00:00:00Z');
const attrs = [{ name: 'commonName', value: 'Test Signer' }, { name: 'organizationName', value: 'CyanTakeoff Tests' }];
cert.setSubject(attrs);
cert.setIssuer(attrs);
cert.sign(keys.privateKey, forge.md.sha256.create());
const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], 'test', { algorithm: '3des' });
writeFileSync('tests/fixtures/test-cert.p12', Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'));
console.log('wrote tests/fixtures/test-cert.p12');
