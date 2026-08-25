plugins {
    base
    alias(libs.plugins.spring.boot) apply false
    alias(libs.plugins.spring.dependency.management) apply false
}

allprojects {
    group = "io.knowledge.platform"
    version = "0.1.0-SNAPSHOT"
}

subprojects {
    pluginManager.withPlugin("java") {
        extensions.configure<JavaPluginExtension> {
            toolchain {
                languageVersion = JavaLanguageVersion.of(25)
            }
        }

        tasks.withType<JavaCompile>().configureEach {
            options.encoding = "UTF-8"
            options.compilerArgs.addAll(listOf("-parameters", "-Xlint:all", "-Werror"))
        }

        tasks.withType<Test>().configureEach {
            useJUnitPlatform()
        }

        dependencies.add("testRuntimeOnly", libs.junit.platform.launcher)
    }
}

tasks.register("checkAll") {
    group = "verification"
    dependsOn(subprojects.map { it.path + ":check" })
}
