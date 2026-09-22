package org.springframework.samples.petclinic.repository.user;

import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest
@ActiveProfiles({"hsqldb", "jpa"})
class UserRepositoryFindByUsernameJpaTests extends AbstractUserRepositoryFindByUsernameTests {
}
