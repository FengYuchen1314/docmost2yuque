package io.knowledge.platform.config;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class CoreConfiguration {

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }
}

