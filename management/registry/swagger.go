package main

// 这份文件用于 swaggo/swag 生成 swagger/openapi spec 时的全局元数据。
// 生成的 spec 会用于前端 TS client + Zod 运行时校验代码生成。

// @title Hive Node Registry API
// @version 0.1.0
// @description Hive management plane API for nodes and subscriptions.
// @BasePath /
// @schemes https http

// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
// @description "Authorization: Bearer <API_SECRET>"

// @securityDefinitions.apikey AdminSessionCookie
// @in cookie
// @name hive_admin_session
// @description "HttpOnly session cookie for admin UI"

