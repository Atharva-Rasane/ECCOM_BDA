import { DataTypes, Model, type ModelStatic } from 'sequelize';
import type {
    HasOneCreateAssociationMixin,
    HasOneGetAssociationMixin,
    HasOneSetAssociationMixin,
} from 'sequelize';
import { UserRoleEnum, type UserAttributes } from '../types/models/userTypes';
import bcrypt from 'bcrypt';
import type { Address } from '.';
import { USER_ROLES } from '../constants';

export class User extends Model<UserAttributes> implements UserAttributes {
    id: number;
    name: string;
    email: string;
    password: string | null;
    phoneNumber: string | null;
    profileImageURL: string | null;
    providerIdentity?: string | null;
    wishlist?: number[];
    role!: UserRoleEnum;
    Address?: Record<string, string>;
    readonly createdAt!: Date;
    readonly updatedAt!: Date;
    verifyPassword: (password) => Promise<boolean>;

    cartItemsCount?: number;

    getAddress: HasOneGetAssociationMixin<Address>;
    setAddress: HasOneSetAssociationMixin<Address, number>;
    createAddress: HasOneCreateAssociationMixin<Address>;
}

export function userFactory(sequelize): ModelStatic<User> {
    const user = User.init(
        {
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            name: {
                type: DataTypes.STRING,
            },
            email: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: true,
            },
            password: {
                type: DataTypes.STRING,
            },
            providerIdentity: {
                type: DataTypes.STRING,
            },
            phoneNumber: {
                type: DataTypes.STRING,
            },
            profileImageURL: {
                type: DataTypes.STRING,
            },
            role: {
                type: DataTypes.ENUM(...Object.values(USER_ROLES)),
                defaultValue: UserRoleEnum.customer,
            },
            wishlist: DataTypes.ARRAY(DataTypes.INTEGER),
        },
        {
            sequelize,
        }
    );

    user.beforeCreate(async (user): Promise<void> => {
        if (user.providerIdentity === undefined) {
            const plainTextPassword = user.password as string;
            user.password = await bcrypt.hash(plainTextPassword, 10);
        }
    });

    user.prototype.verifyPassword = async function (
        password
    ): Promise<boolean> {
        return await bcrypt.compare(password, this.password);
    };
    return user;
}
