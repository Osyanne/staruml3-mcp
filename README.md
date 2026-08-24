# staruml3-mcp

Servidor MCP para **StarUML 3.0.2**.

StarUML V7 trae un [MCP server oficial](https://github.com/staruml/staruml-mcp-server), pero
requiere v7.0.0 o superior. Este proyecto replica esa capacidad contra la v3, para quienes
están obligados a usarla — típicamente porque el `.mdj` tiene que abrir en la versión que
exige una universidad o un cliente.

> **Estado:** diseño aprobado, implementación no empezada.
> Ver [el spec](docs/superpowers/specs/2026-08-24-staruml3-mcp-design.md).

## Cómo funciona

```
Claude Code ──stdio──> staruml3-mcp/          (Node 24, TypeScript)
                          │                    toda la lógica UML vive acá
                          └──HTTP 127.0.0.1──> extensions/user/mcp-bridge/
                                                (Node 7.9, JS plano)
                                                adaptador sobre global.app
```

Son dos mitades. Una extensión mínima que corre dentro de StarUML y expone seis primitivas
sobre la API interna de la app, y un servidor MCP moderno que tiene toda la inteligencia.
La frontera existe porque la extensión ejecuta en el Node 7.9 que trae Electron 1.7.11:
sin optional chaining, sin dependencias, sin debugger. Cada línea que vive ahí adentro es
cara, así que hay las mínimas posibles.

## Alcance

Diagramas de **clases**, **casos de uso**, **entidad-relación** y **secuencia**.
DFD y flowchart funcionan de rebote por las primitivas genéricas, pero sin capa de
conveniencia ni tests.

## Requisitos

- StarUML 3.0.2
- Node.js >= 22 (para el lado del servidor MCP)

## Licencia

MIT
