package io.knowledge.platform.collaboration;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters;
import org.bouncycastle.crypto.signers.Ed25519Signer;

final class CollaborationTicketSigner {

    private final Ed25519PrivateKeyParameters privateKey;

    CollaborationTicketSigner(String encodedPrivateKey) {
        if (encodedPrivateKey == null || encodedPrivateKey.isBlank()) {
            privateKey = null;
            return;
        }
        byte[] key;
        try {
            key = Base64.getDecoder().decode(encodedPrivateKey.trim());
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException(
                    "COLLAB_TICKET_PRIVATE_KEY must be valid base64", exception);
        }
        if (key.length != Ed25519PrivateKeyParameters.KEY_SIZE) {
            throw new IllegalStateException(
                    "COLLAB_TICKET_PRIVATE_KEY must decode to exactly 32 bytes");
        }
        privateKey = new Ed25519PrivateKeyParameters(key);
    }

    boolean configured() {
        return privateKey != null;
    }

    String sign(byte[] payload) {
        if (privateKey == null) {
            throw new IllegalStateException("Collaboration ticket signer is not configured");
        }
        String encodedPayload = Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(payload);
        byte[] message = encodedPayload.getBytes(StandardCharsets.US_ASCII);
        Ed25519Signer signer = new Ed25519Signer();
        signer.init(true, privateKey);
        signer.update(message, 0, message.length);
        byte[] signature = signer.generateSignature();
        return encodedPayload
                + "."
                + Base64.getUrlEncoder()
                        .withoutPadding()
                        .encodeToString(signature);
    }
}
