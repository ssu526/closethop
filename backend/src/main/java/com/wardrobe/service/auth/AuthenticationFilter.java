package com.wardrobe.service.auth;

import com.wardrobe.entity.User;
import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.core.annotation.Order;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.io.IOException;

@Component
@Profile("local")
@Order(1)
@RequiredArgsConstructor
public class AuthenticationFilter implements Filter {
    private final TokenService tokenService;
    private final CurrentUserContext currentUserContext;

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain) throws IOException, ServletException{
        HttpServletRequest httpRequest = (HttpServletRequest) request;
        String authHeader = httpRequest.getHeader("Authorization");

        if(authHeader != null && authHeader.startsWith("Bearer ")){
            String token = authHeader.substring(7);
            try{
                User user = tokenService.validateToken(token);
                currentUserContext.setCurrentUser(user);
            }catch (Exception e){
                // Token invalid, continue without authentication
            }
        }
        try {
            chain.doFilter(request, response);
        } finally {
            currentUserContext.clearCurrentUser();
        }
    }
}
