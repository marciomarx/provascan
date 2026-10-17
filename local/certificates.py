"""A private, per-notebook CA. Only the public certificate leaves this machine."""
import datetime as dt
import hashlib
import ipaddress
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID


def create(directory, addresses):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    keypath, capath = directory / 'ca-key.pem', directory / 'ProvaScan-CA.crt'
    now = dt.datetime.now(dt.timezone.utc)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'ProvaScan - autoridade pessoal')])
    leaf_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'ProvaScan - notebook pessoal')])
    if keypath.exists():
        ca_key = serialization.load_pem_private_key(keypath.read_bytes(), password=None)
        ca = x509.load_pem_x509_certificate(capath.read_bytes())
    else:
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        ca = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(ca_key.public_key())
              .serial_number(x509.random_serial_number()).not_valid_before(now-dt.timedelta(minutes=5))
              .not_valid_after(now+dt.timedelta(days=3650))
              .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
              .add_extension(x509.SubjectKeyIdentifier.from_public_key(ca_key.public_key()), critical=False)
              .add_extension(x509.KeyUsage(False, False, False, False, False, True, True, False, False), critical=True)
              .sign(ca_key, hashes.SHA256()))
        keypath.write_bytes(ca_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        keypath.chmod(0o600)
        capath.write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    names = [x509.DNSName('localhost')]+[x509.IPAddress(ipaddress.ip_address(a)) for a in set(['127.0.0.1', *addresses])]
    cert = (x509.CertificateBuilder().subject_name(leaf_name).issuer_name(ca.subject).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now-dt.timedelta(minutes=5))
            .not_valid_after(now+dt.timedelta(days=365))
            .add_extension(x509.SubjectAlternativeName(names), critical=False)
            .add_extension(x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()), critical=False)
            .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .sign(ca_key, hashes.SHA256()))
    (directory/'server-key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (directory/'server-key.pem').chmod(0o600)
    (directory/'server.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return ca.fingerprint(hashes.SHA256()).hex(':')
