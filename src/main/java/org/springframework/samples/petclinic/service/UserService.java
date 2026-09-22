package org.springframework.samples.petclinic.service;

import org.springframework.samples.petclinic.model.User;

public interface UserService {

    void saveUser(User user);

    /**
     * @return the user or {@code null} if not found
     */
    User findUser(String username);
}
