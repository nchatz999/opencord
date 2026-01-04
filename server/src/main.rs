mod acl;
mod auth;
mod channel;
mod db;
mod error;
mod group;
mod log;
mod managers;
mod message;
mod middleware;
mod model;
mod realtime_server;
mod role;
mod server;
mod subscriber_session;
mod user;
mod voip;
mod transport;

use acl::{AclService, acl_routes};
use auth::{AuthService, auth_routes};
use channel::{ChannelService, channel_routes};
use db::Postgre;
use group::{GroupService, group_routes};
use http::Method;
use log::{LogService, log_routes};
use managers::{
    DefaultLockoutManager, DefaultNotifierManager, DefaultPasswordValidator, LocalFileManager,
    TextLogManager,
};
use message::{MessageService, message_routes};
use middleware::AuthorizeService;
use role::{RoleService, role_routes};
use server::{ServerService, server_routes};
use user::{UserService, user_routes};
use voip::{VoipService, voip_routes};

use axum::extract::DefaultBodyLimit;
use axum_server::tls_rustls::RustlsConfig;
use std::net::SocketAddr;
use std::path::PathBuf;
use tower_http::cors::{AllowHeaders, AllowOrigin, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;

use utoipa_swagger_ui::SwaggerUi;

use crate::realtime_server::RealtimeServer;

pub const CHANNEL_TAG: &str = "channel";
pub const AUTH_TAG: &str = "auth";
pub const ROLE_TAG: &str = "role";
pub const MESSAGE_TAG: &str = "message";
pub const SYNC_TAG: &str = "sync";
pub const ACL_TAG: &str = "acl";
pub const VOIP_TAG: &str = "voip";
pub const FILE_TAG: &str = "file";
pub const LOG_TAG: &str = "log";
pub const SERVER_TAG: &str = "server";

#[derive(OpenApi)]
#[openapi(tags(
    (name = CHANNEL_TAG, description = "Channel API endpoints"),
    (name = AUTH_TAG, description = "Auth API endpoints"),
    (name = ROLE_TAG, description = "Role API endpoints"),
    (name = MESSAGE_TAG, description = "Message API endpoints"),
    (name = SYNC_TAG, description = "Synchronization API endpoints"),
    (name = ACL_TAG, description = "Access Control List API endpoints"),
    (name = VOIP_TAG, description = "VoIP API endpoints"),
    (name = FILE_TAG, description = "File API endpoints"),
    (name = LOG_TAG, description = "Log API endpoints"),
    (name = SERVER_TAG, description = "Server configuration API endpoints")
))]
struct ApiDoc;
#[tokio::main]
async fn main() -> Result<(), sqlx::Error> {
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .expect("Failed to install rustls crypto provider");

    dotenv::from_path(".env").ok();

    let db_url = std::env::var("DATABASE_URL").expect("DATABASE_URL not set");
    let cert_path = PathBuf::from(std::env::var("CERT_PATH").expect("CERT_PATH not set"));
    let key_path = PathBuf::from(std::env::var("KEY_PATH").expect("KEY_PATH not set"));

    let db = sqlx::PgPool::connect(&db_url).await.unwrap();

    let postgre = Postgre { pool: db.clone() };
    let log_manager = TextLogManager::default();
    let mut server = RealtimeServer::new(
        postgre.clone(),
        log_manager.clone(),
        cert_path.clone(),
        key_path.clone(),
    );

    let file_manager = LocalFileManager::new("server/files");
    let avatar_manager = LocalFileManager::new("server/avatars");
    let notifier_manager = DefaultNotifierManager::new(server.subscribe_channel().await);
    let lockout_manager = DefaultLockoutManager::default();
    let password_validator = DefaultPasswordValidator::default();

    let auth_service = AuthService::new(
        postgre.clone(),
        lockout_manager,
        password_validator,
        notifier_manager.clone(),
        log_manager.clone(),
    );
    let authorize_service = AuthorizeService::new(postgre.clone());
    let channel_service = ChannelService::new(
        postgre.clone(),
        notifier_manager.clone(),
        log_manager.clone(),
    );
    let message_service = MessageService::new(
        postgre.clone(),
        file_manager.clone(),
        notifier_manager.clone(),
        log_manager.clone(),
    );
    let acl_service = AclService::new(
        postgre.clone(),
        notifier_manager.clone(),
        log_manager.clone(),
        file_manager.clone(),
    );
    let role_service = RoleService::new(
        postgre.clone(),
        notifier_manager.clone(),
        log_manager.clone(),
    );
    let group_service = GroupService::new(
        postgre.clone(),
        notifier_manager.clone(),
        log_manager.clone(),
    );
    let user_service = UserService::new(
        postgre.clone(),
        avatar_manager.clone(),
        notifier_manager.clone(),
        log_manager.clone(),
    );
    let voip_service = VoipService::new(
        postgre.clone(),
        notifier_manager.clone(),
        log_manager.clone(),
    );
    let log_service = LogService::new(log_manager.clone(), postgre.clone());
    let server_service = ServerService::new(
        postgre.clone(),
        avatar_manager.clone(),
        notifier_manager.clone(),
        log_manager.clone(),
    );

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::any())
        .allow_methods(vec![
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers(AllowHeaders::any());

    tokio::spawn(async move {
        let _ = server.run().await;
    });

    let (router, api) = OpenApiRouter::with_openapi(ApiDoc::openapi())
        .nest(
            "/auth",
            auth_routes(auth_service, authorize_service.clone()),
        )
        .nest(
            "/channel",
            channel_routes(channel_service, authorize_service.clone()),
        )
        .nest(
            "/message",
            message_routes(message_service, authorize_service.clone()),
        )
        .nest("/acl", acl_routes(acl_service, authorize_service.clone()))
        .nest(
            "/role",
            role_routes(role_service, authorize_service.clone()),
        )
        .nest(
            "/group",
            group_routes(group_service, authorize_service.clone()),
        )
        .nest(
            "/user",
            user_routes(user_service, authorize_service.clone()),
        )
        .nest(
            "/voip",
            voip_routes(voip_service, authorize_service.clone()),
        )
        .nest("/log", log_routes(log_service, authorize_service.clone()))
        .nest(
            "/server",
            server_routes(server_service, authorize_service.clone()),
        )
        .layer(DefaultBodyLimit::max(512 * 1024 * 1024))
        .layer(cors)
        .with_state(postgre)
        .split_for_parts();

    let router = router.merge(SwaggerUi::new("/swagger-ui").url("/apidoc/openapi.json", api));

    let serve_client = std::env::var("SERVE_CLIENT")
        .map(|v| v == "true")
        .unwrap_or(false);

    let router = if serve_client {
        let client_path =
            std::env::var("CLIENT_PATH").unwrap_or_else(|_| "client/dist".to_string());
        let index_path = PathBuf::from(&client_path).join("index.html");
        let serve_dir = ServeDir::new(&client_path).fallback(ServeFile::new(&index_path));
        println!("Serving client from: {}", client_path);
        router.fallback_service(serve_dir)
    } else {
        router
    };

    let tls_config = RustlsConfig::from_pem_file(&cert_path, &key_path)
        .await
        .expect("Failed to load TLS certificates");

    let addr = SocketAddr::from(([0, 0, 0, 0], 3000));

    println!("HTTPS server listening on https://0.0.0.0:3000");
    println!("WebTransport server listening on https://localhost:4443");
    println!("Swagger UI available at https://0.0.0.0:3000/swagger-ui");

    axum_server::bind_rustls(addr, tls_config)
        .serve(router.into_make_service_with_connect_info::<SocketAddr>())
        .await
        .unwrap();

    Ok(())
}
