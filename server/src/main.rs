mod acl;
mod auth;
mod channel;
mod common;
mod db;
mod error;
mod group;
mod managers;
mod message;
mod middleware;
mod model;
mod role;
mod user;
mod voip;
mod webtransport;

use acl::{acl_routes, AclService};
use auth::{auth_routes, AuthService};
use channel::{channel_routes, ChannelService};
use db::Postgre;
use dotenv::dotenv;
use group::{group_routes, GroupService};
use http::{HeaderValue, Method};
use managers::{
    DefaultLockoutManager, DefaultNotifierManager, DefaultPasswordValidator, DefaultTotpManager,
    LocalFileManager,
};
use message::{message_routes, MessageService};
use middleware::AuthorizeService;
use role::{role_routes, RoleService};
use user::{user_routes, UserService};
use voip::{voip_routes, VoipService};
use webtransport::WebTransportService;

use std::net::SocketAddr;
use tower_http::cors::{AllowHeaders, CorsLayer};
use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;

use utoipa_swagger_ui::SwaggerUi;

pub const CHANNEL_TAG: &str = "channel";
pub const AUTH_TAG: &str = "auth";
pub const ROLE_TAG: &str = "role";
pub const MESSAGE_TAG: &str = "message";
pub const SYNC_TAG: &str = "sync";
pub const ACL_TAG: &str = "acl";
pub const VOIP_TAG: &str = "voip";
pub const FILE_TAG: &str = "file";

#[derive(OpenApi)]
#[openapi(tags(
    (name = CHANNEL_TAG, description = "Channel API endpoints"),
    (name = AUTH_TAG, description = "Auth API endpoints"),
    (name = ROLE_TAG, description = "Role API endpoints"),
    (name = MESSAGE_TAG, description = "Message API endpoints"),
    (name = SYNC_TAG, description = "Synchronization API endpoints"),
    (name = ACL_TAG, description = "Access Control List API endpoints"),
    (name = VOIP_TAG, description = "VoIP API endpoints"),
    (name = FILE_TAG, description = "File API endpoints")
))]
struct ApiDoc;
#[tokio::main]
async fn main() -> Result<(), sqlx::Error> {
    dotenv::from_path("../.env").ok();

    let db_url = std::env::var("DATABASE_URL").expect("Env not found");

    let db = sqlx::PgPool::connect(&db_url).await.unwrap();

    sqlx::migrate!("./migrations").run(&db).await?;

    let postgre = Postgre { pool: db.clone() };

    let file_manager = LocalFileManager::default();
    let avatar_manager = LocalFileManager::new("./avatars");
    let (notifier_manager, notification_receiver) = DefaultNotifierManager::new();
    let totp_manager = DefaultTotpManager::new();
    let lockout_manager = DefaultLockoutManager::default();
    let password_validator = DefaultPasswordValidator::default();

    let auth_service = AuthService::new(
        postgre.clone(),
        lockout_manager,
        password_validator,
        notifier_manager.clone(),
    );
    let authorize_service = AuthorizeService::new(postgre.clone());
    let channel_service = ChannelService::new(postgre.clone(), notifier_manager.clone());
    let message_service = MessageService::new(
        postgre.clone(),
        file_manager.clone(),
        notifier_manager.clone(),
    );
    let acl_service = AclService::new(postgre.clone(), notifier_manager.clone());
    let role_service = RoleService::new(postgre.clone(), notifier_manager.clone());
    let group_service = GroupService::new(postgre.clone(), notifier_manager.clone());
    let user_service = UserService::new(postgre.clone(), avatar_manager, notifier_manager.clone());
    let voip_service = VoipService::new(postgre.clone(), notifier_manager.clone());
    let webtransport_service = WebTransportService::new(postgre.clone());

    let allowed_origin = "http://localhost:5173".parse::<HeaderValue>().unwrap();
    let cors = CorsLayer::new()
        .allow_origin(allowed_origin)
        .allow_methods(vec![
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers(AllowHeaders::any());

    tokio::spawn(async move {
        if let Err(e) =
            webtransport::start_webtransport_server(webtransport_service, notification_receiver)
                .await
        {
            eprintln!("WebTransport server error: {}", e);
        }
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
        .layer(cors)
        .with_state(postgre)
        .split_for_parts();

    let router = router.merge(SwaggerUi::new("/swagger-ui").url("/apidoc/openapi.json", api));
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();

    println!("HTTP server listening on http://0.0.0.0:3000");
    println!("WebTransport server listening on https://localhost:4433");
    println!("Swagger UI available at http://0.0.0.0:3000/swagger-ui");

    axum::serve(
        listener,
        router.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();

    Ok(())
}
