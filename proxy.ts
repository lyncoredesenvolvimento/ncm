import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// PROXY TEMPORARIAMENTE DESATIVADO PARA DEBUG
// Deixa todas as requisições passarem sem redirecionamento
export function proxy(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/dashboard/:path*"],
};
