package io.knowledge.platform.attachment;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;

class AttachmentTextExtractorTest {
    private final AttachmentTextExtractor extractor=new AttachmentTextExtractor();

    @Test void extractsUtf8Text(){byte[] bytes="项目代号：青鸟\n发布检查清单".getBytes(StandardCharsets.UTF_8);var result=extractor.extract(new ByteArrayResource(bytes),"release.md","text/markdown",bytes.length);assertThat(result.status()).isEqualTo("EXTRACTED");assertThat(result.text()).contains("青鸟","发布检查清单");}
    @Test void stripsHtmlMarkup(){byte[] bytes="<h1>路线图</h1><script>secret()</script><p>第三季度发布</p>".getBytes(StandardCharsets.UTF_8);var result=extractor.extract(new ByteArrayResource(bytes),"roadmap.html","text/html",bytes.length);assertThat(result.text()).contains("路线图","第三季度发布").doesNotContain("<h1>");}
    @Test void skipsOversizedContent(){var result=extractor.extract(new ByteArrayResource(new byte[0]),"large.txt","text/plain",11L*1024*1024);assertThat(result.status()).isEqualTo("TOO_LARGE");assertThat(result.text()).isEmpty();}
}
