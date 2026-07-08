FROM maven:3.9.11-eclipse-temurin-17 AS build
WORKDIR /workspace

COPY backend/pom.xml backend/pom.xml
COPY backend/shared/pom.xml backend/shared/pom.xml
COPY backend/api/pom.xml backend/api/pom.xml
RUN mvn -q -f backend/pom.xml -pl api -am -DskipTests dependency:go-offline

COPY backend/shared/src backend/shared/src
COPY backend/api/src backend/api/src
RUN mvn -q -f backend/pom.xml -pl api -am -DskipTests package

FROM eclipse-temurin:17-jre
WORKDIR /app

RUN useradd --system --uid 10001 wardrobe \
    && apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /workspace/backend/api/target/api-0.0.1-SNAPSHOT.jar app.jar

USER wardrobe
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
