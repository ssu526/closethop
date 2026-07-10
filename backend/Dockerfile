FROM maven:3.9.11-eclipse-temurin-17 AS build
WORKDIR /workspace

COPY backend/pom.xml backend/pom.xml
RUN mvn -q -f backend/pom.xml -DskipTests dependency:go-offline

COPY backend/src backend/src
RUN mvn -q -f backend/pom.xml -DskipTests package

FROM eclipse-temurin:17-jre
WORKDIR /app

RUN useradd --system --uid 10001 wardrobe \
    && apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /workspace/backend/target/backend-0.0.1-SNAPSHOT.jar app.jar
COPY backend/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER wardrobe
EXPOSE 8080
ENTRYPOINT ["/app/docker-entrypoint.sh"]
