import { DataTypes, Model, type ModelStatic } from 'sequelize';
import { type AddressAttributes } from '../types/models/addressTypes';

export class Address
    extends Model<AddressAttributes>
    implements AddressAttributes
{
    id: number;
    street: string;
    state: string;
    country: string;
}

export function addressFactory(sequelize): ModelStatic<Address> {
    return Address.init(
        {
            id: {
                type: DataTypes.INTEGER,
                autoIncrement: true,
                primaryKey: true,
            },
            street: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            state: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            country: {
                type: DataTypes.STRING,
                allowNull: false,
            },
        },
        { sequelize }
    );
}
