package io.knowledge.platform.collaboration;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters;
import org.bouncycastle.crypto.signers.Ed25519Signer;
import org.junit.jupiter.api.Test;

class CollaborationTicketSignerTest {

    @Test
    void signsUrlSafePayloadWithMatchingEd25519PublicKey() throws Exception {
        byte[] seed = new byte[Ed25519PrivateKeyParameters.KEY_SIZE];
        java.util.Arrays.fill(seed, (byte) 7);
        CollaborationTicketSigner signer =
                new CollaborationTicketSigner(Base64.getEncoder().encodeToString(seed));

        String ticket = signer.sign("{\"version\":2}".getBytes(StandardCharsets.UTF_8));
        String[] parts = ticket.split("\\.", -1);
        assertThat(parts).hasSize(2);
        assertThat(new String(
                        Base64.getUrlDecoder().decode(parts[0]), StandardCharsets.UTF_8))
                .isEqualTo("{\"version\":2}");

        Ed25519Signer verifier = new Ed25519Signer();
        verifier.init(false, new Ed25519PrivateKeyParameters(seed).generatePublicKey());
        byte[] message = parts[0].getBytes(StandardCharsets.US_ASCII);
        verifier.update(message, 0, message.length);
        assertThat(verifier.verifySignature(Base64.getUrlDecoder().decode(parts[1])))
                .isTrue();
    }
}
