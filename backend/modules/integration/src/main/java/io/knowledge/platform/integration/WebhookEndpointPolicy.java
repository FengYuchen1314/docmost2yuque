package io.knowledge.platform.integration;

import java.net.InetAddress;import java.net.URI;import java.util.Locale;import org.springframework.beans.factory.annotation.Value;import org.springframework.stereotype.Component;

@Component
final class WebhookEndpointPolicy {
    private final boolean allowHttp,allowPrivate;
    WebhookEndpointPolicy(@Value("${platform.webhooks.allow-http:false}")boolean allowHttp,@Value("${platform.webhooks.allow-private-addresses:false}")boolean allowPrivate){this.allowHttp=allowHttp;this.allowPrivate=allowPrivate;}
    URI validate(String value){try{URI uri=URI.create(value);String scheme=uri.getScheme()==null?"":uri.getScheme().toLowerCase(Locale.ROOT);if(!"https".equals(scheme)&&!(allowHttp&&"http".equals(scheme)))throw new IllegalArgumentException("Webhook endpoint must use HTTPS");if(uri.getHost()==null||uri.getRawUserInfo()!=null||uri.getFragment()!=null)throw new IllegalArgumentException("Webhook endpoint URL is invalid");if(!allowPrivate)for(InetAddress address:InetAddress.getAllByName(uri.getHost()))if(address.isAnyLocalAddress()||address.isLoopbackAddress()||address.isLinkLocalAddress()||address.isSiteLocalAddress()||address.isMulticastAddress())throw new IllegalArgumentException("Webhook endpoint resolves to a private or reserved address");return uri;}catch(IllegalArgumentException exception){throw exception;}catch(Exception exception){throw new IllegalArgumentException("Webhook endpoint cannot be resolved",exception);}}
}
